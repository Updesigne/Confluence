import "dotenv/config";

import { Contract, ContractTransactionResponse } from "ethers";

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

const ZERO_HASH = "0x" + "00".repeat(32);

/**
 * Find the Confluence position bound to a given note.
 *
 * The OpportunityRegistry is shared across test runs and redeploys of
 * Notes, so it may contain many opportunities with venueRefId == noteId.
 * We therefore gather ALL candidates and rank by actionability:
 *
 *   1. EXPLICIT state arg (if it points at PLAN_LOCKED or EXECUTED)
 *   2. Newest EXECUTED position (still holds repayment, needs settle)
 *   3. Newest SETTLED / EMERGENCY_EXIT (nothing to do, informational)
 */
async function findPositionId(
  noteId: bigint,
  opp: Contract,
  conf: Contract,
  fromState: string | undefined
): Promise<bigint | undefined> {
  type Candidate = {
    opportunityId: bigint;
    positionId: bigint;
    status: number;
  };

  // 1. Gather every position bound to any opportunity with venueRefId = noteId
  const nextId = BigInt(await opp.nextOpportunityId());
  const candidates: Candidate[] = [];

  for (let i = 1n; i < nextId; i++) {
    const o = await opp.opportunities(i);
    if (BigInt(o.venueRefId) !== noteId) continue;

    const posId = BigInt(await opp.opportunityPosition(i));
    if (posId === 0n) continue;

    const p = await conf.positions(posId);
    const s = Number(p.status);

    // Skip orphans (FORMING) and CANCELLED
    if (s === 0 || s === 5) continue;

    candidates.push({ opportunityId: i, positionId: posId, status: s });
  }

  if (candidates.length === 0) return undefined;

  // 2. Prefer explicit state arg if it points at an actionable position
  if (fromState) {
    const wanted = BigInt(fromState);
    const hit = candidates.find((c) => c.positionId === wanted);
    if (hit && (hit.status === 1 || hit.status === 2)) {
      log.info(
        {
          chosen: hit.positionId.toString(),
          status: POSITION_STATUS[hit.status],
          source: "state",
        },
        "findPositionId: using explicit state position"
      );
      return hit.positionId;
    }
    if (hit) {
      log.warn(
        {
          wanted: wanted.toString(),
          actualStatus: POSITION_STATUS[hit.status],
        },
        "findPositionId: state position is not actionable — scanning for a better one"
      );
    }
  }

  // 3. Prefer newest EXECUTED — the one that still needs settle()
  const executed = candidates
    .filter((c) => c.status === 2)
    .sort((a, b) => Number(b.opportunityId - a.opportunityId));

  if (executed.length > 0) {
    log.info(
      {
        chosen: executed[0].positionId.toString(),
        status: "EXECUTED",
        allCandidates: candidates.map((c) => ({
          opportunityId: c.opportunityId.toString(),
          positionId: c.positionId.toString(),
          status: POSITION_STATUS[c.status],
        })),
      },
      "findPositionId: chose newest EXECUTED position"
    );
    return executed[0].positionId;
  }

  // 4. Fallback: newest PLAN_LOCKED (execution not yet run)
  const planLocked = candidates
    .filter((c) => c.status === 1)
    .sort((a, b) => Number(b.opportunityId - a.opportunityId));

  if (planLocked.length > 0) {
    log.info(
      {
        chosen: planLocked[0].positionId.toString(),
        status: "PLAN_LOCKED",
        allCandidates: candidates.map((c) => ({
          opportunityId: c.opportunityId.toString(),
          positionId: c.positionId.toString(),
          status: POSITION_STATUS[c.status],
        })),
      },
      "findPositionId: chose newest PLAN_LOCKED position"
    );
    return planLocked[0].positionId;
  }

  // 5. Last resort: newest settled — allows caller to print
  //    an informative "already settled" message
  const settled = candidates
    .filter((c) => c.status === 3 || c.status === 4)
    .sort((a, b) => Number(b.opportunityId - a.opportunityId));

  if (settled.length > 0) {
    log.info(
      {
        chosen: settled[0].positionId.toString(),
        status: POSITION_STATUS[settled[0].status],
        allCandidates: candidates.map((c) => ({
          opportunityId: c.opportunityId.toString(),
          positionId: c.positionId.toString(),
          status: POSITION_STATUS[c.status],
        })),
      },
      "findPositionId: no EXECUTED position — returning already-settled one"
    );
    return settled[0].positionId;
  }

  return undefined;
}

async function waitUntil(target: bigint, label: string) {
  while (true) {
    const block = await wallet.provider!.getBlock("latest");
    if (!block) throw new Error("Unable to read latest block");
    const current = BigInt(block.timestamp);
    if (current >= target) return current;

    const waitSeconds = Math.min(Math.max(Number(target - current), 1), 15);
    log.info(
      { current: current.toString(), target: target.toString(), waitSeconds },
      `Waiting for ${label}`
    );
    await sleep(waitSeconds * 1000);
  }
}

async function main() {
  const d = loadDeployment();
  const c = d.contracts;
  const abi = (name: string) => loadArtifact(name).abi;

  // ------------------------------------------------------------------
  // Args: <noteId> [positionId] [--emergency]
  // ------------------------------------------------------------------
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = new Set(
    process.argv.slice(2).filter((a) => a.startsWith("--"))
  );

  let noteId: bigint;
  if (positional[0]) noteId = BigInt(positional[0]);
  else if (d.notesNoteId) noteId = BigInt(d.notesNoteId);
  else {
    console.error(
      "Usage: tsx scripts/note-settle.ts <noteId> [positionId] [--emergency]"
    );
    process.exit(1);
  }
  const explicitPositionId = positional[1];
  const forceEmergency = flags.has("--emergency");

  const notes = new Contract(c.notes, abi("Notes"), wallet);
  const conf = new Contract(c.confluenceUSDG, abi("Confluence"), wallet);
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
    conf,
    explicitPositionId ?? d.notesPositionId
  );
  if (positionId === undefined) {
    throw new Error(
      "No usable Confluence position found for this note. " +
      "Run scripts/list-positions-for-note.ts to inspect."
    );
  }

  const pos = await conf.positions(positionId);
  const posStatus = Number(pos.status);
  const posMaturity = BigInt(pos.maturity);

  log.info(
    {
      positionId: positionId.toString(),
      status: `${posStatus} (${POSITION_STATUS[posStatus]})`,
      maturity: posMaturity.toString(),
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
    log.info(
      `Position already ${POSITION_STATUS[posStatus]} — nothing to do. ` +
      `If the note is still FUNDED, another position likely holds the repayment; ` +
      `run scripts/list-positions-for-note.ts ${noteId} to find it.`
    );
    return;
  }
  if (posStatus !== 2) {
    throw new Error(
      `Position ${positionId} is ${POSITION_STATUS[posStatus]} — needs EXECUTED`
    );
  }

  // ------------------------------------------------------------------
  // Build settlement call and check hashes
  // ------------------------------------------------------------------
  const repayCall = {
    target: c.notes,
    value: 0n,
    data: notes.interface.encodeFunctionData("markRepaid", [noteId]),
  };

  const computedHash: string = await router.hashCalls([repayCall]);

  const hasSettlementHash = pos.settlementHash !== ZERO_HASH;
  const hasEmergencyHash = pos.emergencySettlementHash !== ZERO_HASH;

  const matchesSettlement =
    hasSettlementHash && computedHash === pos.settlementHash;
  const matchesEmergency =
    hasEmergencyHash && computedHash === pos.emergencySettlementHash;

  log.info(
    {
      computedHash,
      hasSettlementHash,
      hasEmergencyHash,
      matchesSettlement,
      matchesEmergency,
      repayCallData: repayCall.data,
    },
    "Hash comparison"
  );

  if (!matchesSettlement && !matchesEmergency) {
    throw new Error(
      `repayCall hash matches neither settlementHash nor emergencySettlementHash.\n` +
      `  repayCall.data:            ${repayCall.data}\n` +
      `  computed hash:             ${computedHash}\n` +
      `  settlementHash:            ${pos.settlementHash}\n` +
      `  emergencySettlementHash:   ${pos.emergencySettlementHash}\n` +
      `The plan was locked with a different settlement call. ` +
      `Check the exact arg list and target used at lockPlan time.`
    );
  }

  // ------------------------------------------------------------------
  // Wait for BOTH maturities (note's and position's)
  // ------------------------------------------------------------------
  const waitUntilTs =
    posMaturity > noteMaturity ? posMaturity : noteMaturity;

  log.info(
    {
      noteMaturity: noteMaturity.toString(),
      positionMaturity: posMaturity.toString(),
      effectiveWait: waitUntilTs.toString(),
    },
    "Waiting for the later of the two maturities"
  );

  await waitUntil(waitUntilTs, "maturity");

  // ------------------------------------------------------------------
  // Roles
  // ------------------------------------------------------------------
  const isAgg: boolean = await conf.aggregator(address);
  const isEmergencyOp: boolean = await conf.emergencyOperator(address);
  const protocolOwner: string = await conf.protocolOwner();
  const isProtocolOwner =
    address.toLowerCase() === protocolOwner.toLowerCase();

  log.info(
    {
      wallet: address,
      isAggregator: isAgg,
      isEmergencyOperator: isEmergencyOp,
      protocolOwner,
      isProtocolOwner,
    },
    "Roles"
  );

  // ------------------------------------------------------------------
  // Deadline check
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

  // ------------------------------------------------------------------
  // Decide path
  // ------------------------------------------------------------------
  const useEmergency =
    forceEmergency || !withinDeadline || !isAgg || !matchesSettlement;

  let txLabel: string;
  let txPromise: Promise<ContractTransactionResponse>;

  if (!useEmergency) {
    log.info(
      {
        path: "settle",
        reason: "within deadline, aggregator, hash matches",
      },
      "Selected normal settlement path"
    );
    txLabel = "Confluence.settle Notes position";
    txPromise = conf.settle(
      positionId,
      [repayCall]
    ) as Promise<ContractTransactionResponse>;
  } else {
    const canEmergency = isProtocolOwner || isEmergencyOp;
    if (!canEmergency) {
      throw new Error(
        `Cannot use emergency path: wallet is neither protocolOwner nor emergencyOperator.\n` +
        `  wallet:           ${address}\n` +
        `  protocolOwner:    ${protocolOwner}\n` +
        `  isProtocolOwner:  ${isProtocolOwner}\n` +
        `  isEmergencyOp:    ${isEmergencyOp}\n` +
        `Ask the deployer to grant you emergencyOperator rights, or have them run this script.`
      );
    }
    if (!matchesEmergency) {
      throw new Error(
        `Emergency path requires hash to match emergencySettlementHash.\n` +
        `  computed:                 ${computedHash}\n` +
        `  emergencySettlementHash:  ${pos.emergencySettlementHash}\n` +
        `The emergency hash was set to a different call list. Reconstruct it.`
      );
    }
    log.info(
      {
        path: "emergencyExit",
        reason: forceEmergency
          ? "forced via --emergency"
          : !withinDeadline
            ? "past settlementDeadline"
            : !isAgg
              ? "wallet is not an aggregator"
              : "settlementHash mismatch",
      },
      "Selected emergency path"
    );
    txLabel = "Confluence.emergencyExit Notes position";
    txPromise = conf.emergencyExit(
      positionId,
      [repayCall]
    ) as Promise<ContractTransactionResponse>;
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
      noteStatus: `${afterNote.status} (${NOTE_STATUS[Number(afterNote.status)]
        })`,
      positionStatus: `${afterPos.status} (${POSITION_STATUS[Number(afterPos.status)]
        })`,
      returnedTotal: afterPos.returnedTotal.toString(),
    },
    "Settlement result"
  );

  if (Number(afterNote.status) !== 2) {
    throw new Error("Note did not reach REPAID — check Arbiscan");
  }

  // ------------------------------------------------------------------
  // Next steps
  // ------------------------------------------------------------------
  log.info(
    {
      noteId: noteId.toString(),
      positionId: positionId.toString(),
      vaultWithdrawHint:
        "Account owner must call vault.withdraw(accountId, amount) to pull settled funds out of the vault",
      collateralHint:
        "Borrower must call notes.withdrawCollateral(noteId) to reclaim collateral",
    },
    "Settlement complete — follow-up actions required"
  );
}

main().catch((err) => {
  log.error({ err }, "Notes settle failed");
  process.exit(1);
});