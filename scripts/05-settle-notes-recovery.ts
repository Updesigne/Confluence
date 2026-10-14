import "dotenv/config";

import { Contract } from "ethers";

import { loadArtifact } from "./lib/artifacts";
import { address, wallet } from "./lib/env";
import { log, sleep, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";

const NOTE_STATUS = [
  "OPEN",
  "FUNDED",
  "REPAID",
  "DEFAULTED",
  "LIQUIDATED",
  "CANCELLED",
] as const;

const POSITION_STATUS = [
  "FORMING",
  "PLAN_LOCKED",
  "EXECUTED",
  "SETTLED",
  "EMERGENCY_EXIT",
  "CANCELLED",
] as const;

async function findPositionId(
  noteId: bigint,
  opp: Contract,
  fromState: string | undefined
): Promise<bigint | undefined> {
  if (fromState) return BigInt(fromState);
  const nextId = BigInt(await opp.nextOpportunityId());
  for (let i = 1n; i < nextId; i++) {
    const o = await opp.opportunities(i);
    if (BigInt(o.venueRefId) === noteId) {
      const pos = BigInt(await opp.opportunityPosition(i));
      if (pos !== 0n) return pos;
    }
  }
  return undefined;
}

async function main() {
  const d = loadDeployment();
  const c = d.contracts;
  const abi = (name: string) => loadArtifact(name).abi;

  const arg = process.argv[2];
  let noteId: bigint;
  if (arg) noteId = BigInt(arg);
  else if (d.notesNoteId) noteId = BigInt(d.notesNoteId);
  else {
    console.error("Usage: tsx scripts/note-settle.ts <noteId> [positionId]");
    process.exit(1);
  }
  const explicitPositionId = process.argv[3];

  const notes = new Contract(c.notes, abi("Notes"), wallet);
  const conf = new Contract(c.confluenceNotes, abi("Confluence"), wallet);
  const opp = new Contract(c.opportunities, abi("OpportunityRegistry"), wallet);
  const router = new Contract(c.router, abi("ExecutionRouter"), wallet);

  // ------------------------------------------------------------------
  // Note state
  // ------------------------------------------------------------------
  const note = await notes.notes(noteId);
  if (note.id === 0n) throw new Error(`Note ${noteId} does not exist`);

  const noteStatus = Number(note.status);
  const requested = BigInt(note.requested);
  const interest = BigInt(note.interest);
  const owed = requested + interest;
  const repaidAmount = BigInt(note.repaidAmount);
  const noteMaturity = BigInt(note.maturity);

  log.info(
    {
      noteId: noteId.toString(),
      status: `${noteStatus} (${NOTE_STATUS[noteStatus]})`,
      requested: requested.toString(),
      interest: interest.toString(),
      owed: owed.toString(),
      repaidAmount: repaidAmount.toString(),
      maturity: noteMaturity.toString(),
    },
    "Note state"
  );

  if (noteStatus === 2) {
    log.info("Note already REPAID — nothing to do");
    return;
  }
  if (noteStatus !== 1 && noteStatus !== 3) {
    throw new Error(`Note ${noteId} is ${NOTE_STATUS[noteStatus]}`);
  }
  if (repaidAmount < owed) {
    throw new Error(
      `Note not fully repaid (repaid=${repaidAmount}, owed=${owed}). ` +
        `Run the frontend repay first.`
    );
  }

  // ------------------------------------------------------------------
  // Position state
  // ------------------------------------------------------------------
  const positionId = await findPositionId(
    noteId,
    opp,
    explicitPositionId ?? d.notesPositionId
  );
  if (positionId === undefined) {
    throw new Error("No Confluence position found for this note");
  }

  const pos = await conf.positions(positionId);
  const posStatus = Number(pos.status);

  log.info(
    {
      positionId: positionId.toString(),
      status: `${posStatus} (${POSITION_STATUS[posStatus]})`,
      maturity: pos.maturity.toString(),
      settlementDeadline: pos.settlementDeadline.toString(),
      settlementHash: pos.settlementHash,
      emergencySettlementHash: pos.emergencySettlementHash,
      minReturn: pos.minReturn.toString(),
      emergencyMinReturn: pos.emergencyMinReturn.toString(),
      creator: pos.creator,
    },
    "Position state"
  );

  if (posStatus === 3 || posStatus === 4) {
    log.info(`Position already ${POSITION_STATUS[posStatus]} — nothing to do`);
    return;
  }
  if (posStatus !== 2) {
    throw new Error(
      `Position ${positionId} is ${POSITION_STATUS[posStatus]} — needs EXECUTED`
    );
  }

  // ------------------------------------------------------------------
  // Build the settlement call
  // ------------------------------------------------------------------
  const repayCall = {
    target: c.notes,
    value: 0n,
    data: notes.interface.encodeFunctionData("markRepaid", [noteId]),
  };

  const computedHash: string = await router.hashCalls([repayCall]);

  const matchesSettlement = computedHash === pos.settlementHash;
  const matchesEmergency = computedHash === pos.emergencySettlementHash;

  log.info(
    {
      computedHash,
      matchesSettlement,
      matchesEmergency,
    },
    "Hash comparison"
  );

  if (!matchesSettlement && !matchesEmergency) {
    throw new Error(
      `repayCall hash matches neither settlementHash nor emergencySettlementHash.\n` +
        `  computed:              ${computedHash}\n` +
        `  settlementHash:        ${pos.settlementHash}\n` +
        `  emergencySettlementHash: ${pos.emergencySettlementHash}\n` +
        `The plan was locked with different settlement call args.`
    );
  }

  // ------------------------------------------------------------------
  // Wait for note maturity (needed for both paths)
  // ------------------------------------------------------------------
  while (true) {
    const block = await wallet.provider!.getBlock("latest");
    if (!block) throw new Error("Unable to read latest block");
    const current = BigInt(block.timestamp);
    if (current >= noteMaturity) break;

    const waitSeconds = Math.min(Math.max(Number(noteMaturity - current), 1), 15);
    log.info(
      {
        current: current.toString(),
        maturity: noteMaturity.toString(),
        waitSeconds,
      },
      "Waiting for maturity"
    );
    await sleep(waitSeconds * 1000);
  }

  // ------------------------------------------------------------------
  // Aggregator / operator check
  // ------------------------------------------------------------------
  const isAgg: boolean = await conf.aggregator(address);
  const isEmergencyOp: boolean = await conf.emergencyOperator(address);
  const protocolOwner: string = await conf.protocolOwner();

  log.info(
    {
      wallet: address,
      isAggregator: isAgg,
      isEmergencyOperator: isEmergencyOp,
      protocolOwner,
      isProtocolOwner:
        address.toLowerCase() === protocolOwner.toLowerCase(),
    },
    "Roles"
  );

  // ------------------------------------------------------------------
  // Decide path
  // ------------------------------------------------------------------
  const latest = await wallet.provider!.getBlock("latest");
  const now = BigInt(latest!.timestamp);
  const withinDeadline = now <= BigInt(pos.settlementDeadline);

  log.info(
    {
      now: now.toString(),
      settlementDeadline: pos.settlementDeadline.toString(),
      withinDeadline,
    },
    "Deadline check"
  );

  let txLabel: string;
  let txPromise: Promise<any>;

  if (withinDeadline && isAgg && matchesSettlement) {
    // Preferred: normal settle
    log.info("Path: Confluence.settle (within deadline)");
    txLabel = "Confluence.settle Notes position";
    txPromise = conf.settle(positionId, [repayCall]);
  } else {
    // Emergency path
    const canEmergency =
      address.toLowerCase() === protocolOwner.toLowerCase() || isEmergencyOp;

    if (!canEmergency) {
      throw new Error(
        `Cannot settle: past settlementDeadline and wallet ${address} ` +
          `is neither protocolOwner (${protocolOwner}) nor an emergencyOperator. ` +
          `Ask the deployer to grant you emergencyOperator, or have them run this.`
      );
    }
    if (!matchesEmergency) {
      throw new Error(
        `Emergency path requires the call hash to match emergencySettlementHash, ` +
          `but it only matched settlementHash. Reconstruct the emergency call list.`
      );
    }

    log.info("Path: Confluence.emergencyExit (past deadline or not aggregator)");
    txLabel = "Confluence.emergencyExit Notes position";
    txPromise = conf.emergencyExit(positionId, [repayCall]);
  }

  await waitTx(txLabel, await txPromise);

  // ------------------------------------------------------------------
  // Verify
  // ------------------------------------------------------------------
  const afterNote = await notes.notes(noteId);
  const afterPos = await conf.positions(positionId);

  log.info(
    {
      noteId: noteId.toString(),
      noteStatus: `${afterNote.status} (${NOTE_STATUS[Number(afterNote.status)]})`,
      positionStatus: `${afterPos.status} (${POSITION_STATUS[Number(afterPos.status)]})`,
      returnedTotal: afterPos.returnedTotal.toString(),
    },
    "Settlement result"
  );

  if (Number(afterNote.status) !== 2) {
    throw new Error("Note did not reach REPAID — check Arbiscan");
  }
}

main().catch((err) => {
  log.error({ err }, "Notes settle failed");
  process.exit(1);
});