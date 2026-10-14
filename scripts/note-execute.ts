import "dotenv/config";

import { Contract, Interface } from "ethers";

import { loadArtifact } from "./lib/artifacts";
import { address, wallet } from "./lib/env";
import { eventArg } from "./lib/events";
import { log, waitTx } from "./lib/logger";
import { loadDeployment, saveDeployment } from "./lib/state";

async function main() {
  // ------------------------------------------------------------------
  // Arg: note ID
  // ------------------------------------------------------------------
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: tsx scripts/notes-open.ts <noteId>");
    process.exit(1);
  }
  const noteId = BigInt(arg);

  // Pre-created on the frontend:
  const accountId = 1n;
  const mandateId = 1n;

  const d = loadDeployment();
  const c = d.contracts;
  const abi = (name: string) => loadArtifact(name).abi;

  const usdg = new Contract(c.usdg, abi("MockUSDG"), wallet);
  const notes = new Contract(c.notes, abi("Notes"), wallet);
  const vault = new Contract(c.vaultUSDG, abi("CapitalVault"), wallet);
  const mandates = new Contract(c.mandatesUSDG, abi("MandateRegistry"), wallet);
  const opp = new Contract(c.opportunities, abi("OpportunityRegistry"), wallet);
  const router = new Contract(c.router, abi("ExecutionRouter"), wallet);
  const conf = new Contract(c.confluenceUSDG, abi("Confluence"), wallet);

  const mandateInterface = new Interface(abi("MandateRegistry"));
  const confluenceInterface = new Interface(abi("Confluence"));

  // ------------------------------------------------------------------
  // Read the note
  // ------------------------------------------------------------------
  const note = await notes.notes(noteId);

  if (note.id === 0n) {
    throw new Error(`Note ${noteId} does not exist`);
  }

  // Status enum: 0=OPEN, 1=FUNDED, 2=REPAID, 3=DEFAULTED, 4=LIQUIDATED, 5=CANCELLED
  const STATUS_OPEN = 0n;
  if (BigInt(note.status) !== STATUS_OPEN) {
    throw new Error(
      `Note ${noteId} is not OPEN (status=${note.status.toString()})`
    );
  }

  const requested = BigInt(note.requested);
  const collateral = BigInt(note.collateralAmount);
  const interest = BigInt(note.interest);
  const duration = BigInt(note.duration);

  log.info(
    {
      noteId: noteId.toString(),
      borrower: note.borrower,
      requested: requested.toString(),
      collateral: collateral.toString(),
      interest: interest.toString(),
      duration: duration.toString(),
    },
    "Read Notes details"
  );

  // ------------------------------------------------------------------
  // Validate mandate 1 allows Notes venue + this asset
  // ------------------------------------------------------------------
  const mandate = await mandates.getMandate(mandateId);

  if (mandate.owner !== address) {
    throw new Error(
      `Mandate ${mandateId} is owned by ${mandate.owner}, not ${address}`
    );
  }
  if (mandate.asset !== c.usdg) {
    throw new Error(`Mandate ${mandateId} asset mismatch`);
  }

  const venueOk = await mandates.isVenueAllowed(mandateId, c.notes);
  if (!venueOk) {
    throw new Error(`Mandate ${mandateId} does not allow venue ${c.notes}`);
  }

  // // Compliance check using the note's actual parameters
  const compliant = await mandates.isCompliant(
    mandateId,
    c.usdg,
    c.notes,
    requested,
    duration,
    0n, // liquidityBps for this opportunity
    0,  // riskClass
    false // leverage
  );

  if (!compliant) {
    throw new Error(`Note ${noteId} parameters violate mandate ${mandateId}`);
  }

  // ------------------------------------------------------------------
  // Ensure account 1 has enough available USDC
  // ------------------------------------------------------------------
  const account = await vault.account(accountId);

  if (!account.active) {
    throw new Error(`Account ${accountId} is not active`);
  }
  if (account.owner !== address) {
    throw new Error(
      `Account ${accountId} owned by ${account.owner}, not ${address}`
    );
  }

  let available = BigInt(account.available);

  log.info(
    {
      accountId: accountId.toString(),
      available: available.toString(),
      needed: requested.toString(),
    },
    "Account balance check"
  );

  if (available < requested) {
    const missing = requested - available;

    await waitTx(
      `mint ${missing.toString()} USDC`,
      await usdg.mint(address, missing)
    );

    await waitTx(
      `approve USDC for vault`,
      await usdg.approve(c.vaultUSDG, missing)
    );

    await waitTx(
      `deposit ${missing.toString()} USDC into account ${accountId}`,
      await vault.deposit(accountId, missing)
    );
  }

  // ------------------------------------------------------------------
  // Timing
  // ------------------------------------------------------------------
  const latest = await wallet.provider!.getBlock("latest");
  if (!latest) throw new Error("Unable to read latest block");

  const now = BigInt(latest.timestamp);

  const executionWindowSeconds = 10 * 60;
  const settlementBufferSeconds = 10 * 60;

  const executionDeadline = now + BigInt(executionWindowSeconds);
  const plannedMaturity = executionDeadline + duration;
  const settlementDeadline = plannedMaturity + BigInt(settlementBufferSeconds);
  const opportunityDeadline = now + 30n * 60n;

  log.info(
    {
      now: now.toString(),
      executionDeadline: executionDeadline.toString(),
      plannedMaturity: plannedMaturity.toString(),
      settlementDeadline: settlementDeadline.toString(),
    },
    "Timing configured"
  );

  // ------------------------------------------------------------------
  // Create opportunity
  // ------------------------------------------------------------------
  await waitTx(
    "create Notes market opportunity",
    await opp.createOpportunity({
      asset: c.usdg,
      venue: c.notes,
      adapter: c.notes,
      capacity: requested,
      duration,
      liquidityBps: 0,
      riskClass: 0,
      usesLeverage: false,
      minReturn: requested,
      deadline: opportunityDeadline,
      metadataHash: "0x" + "99".repeat(32),
      venueRefId: noteId,
    })
  );

  const opportunityId = (await opp.nextOpportunityId()) - 1n;

  log.info(
    { opportunityId: opportunityId.toString() },
    "Opportunity created"
  );

  // ------------------------------------------------------------------
  // Aggregator check
  // ------------------------------------------------------------------
  const isAggregator = await conf.aggregator(address);
  if (!isAggregator) {
    throw new Error(
      `Wallet ${address} is not an aggregator for ${c.confluenceUSDG}`
    );
  }

  // ------------------------------------------------------------------
  // Create Confluence position
  // ------------------------------------------------------------------
  const positionReceipt = await waitTx(
    "Confluence.create Notes position",
    await conf.create(
      opportunityId,
      requested,
      requested,
      executionDeadline,
      settlementDeadline
    )
  );

  const positionId = eventArg(
    positionReceipt,
    confluenceInterface,
    "Created",
    "id"
  );

  if (positionId === undefined) {
    throw new Error("Confluence Created event not found");
  }

  // ------------------------------------------------------------------
  // Add participant (account 1, mandate 1)
  // ------------------------------------------------------------------
  await waitTx(
    `Confluence.addParticipant account ${accountId}`,
    await conf.addParticipant(positionId, accountId, mandateId, requested)
  );

  const notesRouter: string = await notes.router();
  if (notesRouter.toLowerCase() !== c.router.toLowerCase()) {
    await waitTx(
      "notes.setRouter(router)",
      await notes.setRouter(c.router)
    );
  }


  // ------------------------------------------------------------------
  // Build calls
  // ------------------------------------------------------------------
  const drawCall = {
    target: c.notes,
    value: 0n,
    data: notes.interface.encodeFunctionData("draw", [noteId, requested]),
  };

  const repayCall = {
    target: c.notes,
    value: 0n,
    data: notes.interface.encodeFunctionData("markRepaid", [noteId]),
  };

  const executionHash = await router.hashCalls([drawCall]);
  const settlementHash = await router.hashCalls([repayCall]);

  // ------------------------------------------------------------------
  // Lock plan
  // ------------------------------------------------------------------
  await waitTx(
    "Confluence.lockPlan Notes",
    await conf.lockPlan(positionId, {
      executionHash,
      settlementHash,
      emergencySettlementHash: settlementHash,
      positionMetadataHash: "0x" + "aa".repeat(32),
      maturity: plannedMaturity,
      emergencyMinReturn: requested,
    })
  );

  // ------------------------------------------------------------------
  // Execute draw
  // ------------------------------------------------------------------
  await waitTx(
    "Confluence.execute Notes draw",
    await conf.execute(positionId, [drawCall])
  );

  // ------------------------------------------------------------------
  // Verify the note is now FUNDED
  // ------------------------------------------------------------------
  const after = await notes.notes(noteId);
  const STATUS_FUNDED = 1n;

  if (BigInt(after.status) !== STATUS_FUNDED) {
    log.warn(
      { status: after.status.toString() },
      "Note did not transition to FUNDED as expected"
    );
  }

  // ------------------------------------------------------------------
  // Persist state
  // ------------------------------------------------------------------
  d.notesAccountIds = [accountId.toString()];
  d.notesMandateIds = [mandateId.toString()];
  d.notesNoteId = noteId.toString();
  d.notesOpportunityId = opportunityId.toString();
  d.notesPositionId = positionId.toString();
  d.notesRequested = requested.toString();
  d.notesInterest = interest.toString();

  saveDeployment(d);

  log.info(
    {
      noteId: noteId.toString(),
      accountId: accountId.toString(),
      mandateId: mandateId.toString(),
      opportunityId: opportunityId.toString(),
      positionId: positionId.toString(),
      requested: requested.toString(),
      maturity: after.maturity.toString(),
    },
    "Notes loan opened"
  );
}

main().catch((err) => {
  log.error({ err }, "Notes open failed");
  process.exit(1);
});