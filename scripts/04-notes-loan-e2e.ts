import "dotenv/config";

import {
  Contract,
  Interface,
  parseUnits,
} from "ethers";

import { loadArtifact } from "./lib/artifacts";
import { address, wallet } from "./lib/env";
import { eventArg } from "./lib/events";
import {
  log,
  sleep,
  waitTx,
} from "./lib/logger";
import {
  loadDeployment,
  saveDeployment,
} from "./lib/state";

async function main() {
  const d = loadDeployment();
  const c = d.contracts;

  const abi = (name: string) =>
    loadArtifact(name).abi;

  const usdc = new Contract(
    c.usdc,
    abi("MockUSDC"),
    wallet
  );

  const weth = new Contract(
    c.weth,
    abi("MockWETH"),
    wallet
  );

  const notes = new Contract(
    c.notes,
    abi("Notes"),
    wallet
  );

  const vault = new Contract(
    c.vaultUSDC,
    abi("CapitalVault"),
    wallet
  );

  const mandates = new Contract(
    c.mandatesUSDC,
    abi("MandateRegistry"),
    wallet
  );

  const opp = new Contract(
    c.opportunities,
    abi("OpportunityRegistry"),
    wallet
  );

  const router = new Contract(
    c.router,
    abi("ExecutionRouter"),
    wallet
  );

  const conf = new Contract(
    c.confluenceNotes,
    abi("Confluence"),
    wallet
  );

  const notesInterface =
    new Interface(abi("Notes"));

  const vaultInterface =
    new Interface(abi("CapitalVault"));

  const mandateInterface =
    new Interface(abi("MandateRegistry"));

  const confluenceInterface =
    new Interface(abi("Confluence"));

  // ------------------------------------------------------------------
  // Parameters
  // ------------------------------------------------------------------

  const principal =
    parseUnits("1000", 6);

  const interest =
    parseUnits("10", 6);

  const collateral =
    parseUnits("1", 18);

  const duration = 60;

  const executionWindowSeconds =
    10 * 60;

  const settlementBufferSeconds =
    10 * 60;

  // ------------------------------------------------------------------
  // Wallet
  // ------------------------------------------------------------------

  log.info(
    {
      wallet: address,
      notes: c.notes,
      router: c.router,
      confluence: c.confluenceNotes,
    },
    "Starting Notes E2E"
  );

  // ------------------------------------------------------------------
  // WETH collateral
  // ------------------------------------------------------------------

  let wethBalance =
    await weth.balanceOf(address);

  log.info(
    {
      wallet: address,
      wethBalance:
        wethBalance.toString(),
      required:
        collateral.toString(),
    },
    "Checking WETH collateral"
  );

  if (wethBalance < collateral) {
    const missing =
      collateral - wethBalance;

    await waitTx(
      "mint Notes WETH collateral",
      await weth.mint(
        address,
        missing
      )
    );
  }

  wethBalance =
    await weth.balanceOf(address);

  if (wethBalance < collateral) {
    throw new Error(
      `Insufficient WETH: ` +
      `have ${wethBalance.toString()}, ` +
      `need ${collateral.toString()}`
    );
  }

  await waitTx(
    "approve Notes WETH collateral",
    await weth.approve(
      c.notes,
      collateral
    )
  );

  // ------------------------------------------------------------------
  // Create Note
  // ------------------------------------------------------------------

  const noteReceipt =
    await waitTx(
      "create 1000 USDC Notes loan",
      await notes.createNote(
        principal,
        collateral,
        interest,
        duration,
        "0x" + "55".repeat(32),
        "0x" + "66".repeat(32)
      )
    );

  const noteId =
    eventArg(
      noteReceipt,
      notesInterface,
      "Created",
      "id"
    );

  if (noteId === undefined)
    throw new Error(
      "Notes Created event not found"
    );

  log.info(
    {
      noteId: noteId.toString(),
    },
    "Notes loan created"
  );

  // ------------------------------------------------------------------
  // Capital accounts
  // ------------------------------------------------------------------

  const amounts = [
    parseUnits("600", 6),
    parseUnits("400", 6),
  ];

  const accountIds: bigint[] = [];
  const mandateIds: bigint[] = [];

  for (
    let i = 0;
    i < amounts.length;
    i++
  ) {
    const accountReceipt =
      await waitTx(
        `create USDC capital account ${i + 1}`,
        await vault.createAccount()
      );

    const accountId =
      eventArg(
        accountReceipt,
        vaultInterface,
        "AccountCreated",
        "accountId"
      );

    if (accountId === undefined)
      throw new Error(
        "AccountCreated event not found"
      );

    accountIds.push(accountId);

    await waitTx(
      `approve USDC deposit ${i + 1}`,
      await usdc.approve(
        c.vaultUSDC,
        amounts[i]
      )
    );

    await waitTx(
      `deposit ${amounts[i].toString()} USDC ${i + 1}`,
      await vault.deposit(
        accountId,
        amounts[i]
      )
    );

    const mandateReceipt =
      await waitTx(
        `create Notes mandate ${i + 1}`,
        await mandates.createMandate({
          accountId,
          asset: c.usdc,
          initialVenues: [c.notes],
          maxAllocation: amounts[i],

          minDuration: 1,
          maxDuration: 3600,

          minLiquidityBps: 0,
          maxRiskClass: 255,

          leverageAllowed: false,

          purposeHash:
            "0x" + "77".repeat(32),

          policyHash:
            "0x" + "88".repeat(32),
        })
      );

    const mandateId =
      eventArg(
        mandateReceipt,
        mandateInterface,
        "MandateCreated",
        "mandateId"
      );

    if (mandateId === undefined)
      throw new Error(
        "MandateCreated event not found"
      );

    mandateIds.push(mandateId);
  }

  // ------------------------------------------------------------------
  // Timing
  // ------------------------------------------------------------------

  const latest =
    await wallet.provider!.getBlock(
      "latest"
    );

  if (!latest)
    throw new Error(
      "Unable to read latest block"
    );

  const now =
    BigInt(latest.timestamp);

  const executionDeadline =
    now +
    BigInt(executionWindowSeconds);

  const plannedMaturity =
    executionDeadline +
    BigInt(duration);

  const settlementDeadline =
    plannedMaturity +
    BigInt(settlementBufferSeconds);

  const opportunityDeadline =
    now + 30n * 60n;

  log.info(
    {
      now: now.toString(),
      executionDeadline:
        executionDeadline.toString(),
      plannedMaturity:
        plannedMaturity.toString(),
      settlementDeadline:
        settlementDeadline.toString(),
    },
    "Notes timing configured"
  );

  // ------------------------------------------------------------------
  // Opportunity
  // ------------------------------------------------------------------

  await waitTx(
    "create Notes market opportunity",
    await opp.createOpportunity({
      asset: c.usdc,
      venue: c.notes,
      adapter: c.notes,

      capacity: principal,
      duration,

      liquidityBps: 0,
      riskClass: 0,
      usesLeverage: false,

      minReturn: principal,

      deadline:
        opportunityDeadline,

      metadataHash:
        "0x" + "99".repeat(32),

      venueRefId: noteId,
    })
  );

  const opportunityId =
    (await opp.nextOpportunityId()) -
    1n;

  // ------------------------------------------------------------------
  // Verify Confluence aggregator
  // ------------------------------------------------------------------

  const isAggregator =
    await conf.aggregator(address);

  if (!isAggregator) {
    throw new Error(
      `Wallet ${address} is not an aggregator for ` +
      `${c.confluenceNotes}`
    );
  }

  // ------------------------------------------------------------------
  // Create Confluence position
  // ------------------------------------------------------------------

  const positionReceipt =
    await waitTx(
      "Confluence.create Notes position",
      await conf.create(
        opportunityId,
        principal,
        principal,
        executionDeadline,
        settlementDeadline
      )
    );

  const positionId =
    eventArg(
      positionReceipt,
      confluenceInterface,
      "Created",
      "id"
    );

  if (positionId === undefined)
    throw new Error(
      "Confluence Created event not found"
    );

  // ------------------------------------------------------------------
  // Participants
  // ------------------------------------------------------------------

  await waitTx(
    "Confluence.addParticipant Notes A",
    await conf.addParticipant(
      positionId,
      accountIds[0],
      mandateIds[0],
      amounts[0]
    )
  );

  await waitTx(
    "Confluence.addParticipant Notes B",
    await conf.addParticipant(
      positionId,
      accountIds[1],
      mandateIds[1],
      amounts[1]
    )
  );

  // ------------------------------------------------------------------
  // Calls
  // ------------------------------------------------------------------

  const drawCall = {
    target: c.notes,
    value: 0n,
    data:
      notes.interface.encodeFunctionData(
        "draw",
        [
          noteId,
          principal,
        ]
      ),
  };

  const repayCall = {
    target: c.notes,
    value: 0n,
    data:
      notes.interface.encodeFunctionData(
        "markRepaid",
        [noteId]
      ),
  };

  const executionHash =
    await router.hashCalls([
      drawCall,
    ]);

  const settlementHash =
    await router.hashCalls([
      repayCall,
    ]);

  // ------------------------------------------------------------------
  // Lock plan
  // ------------------------------------------------------------------

  await waitTx(
    "Confluence.lockPlan Notes",
    await conf.lockPlan(
      positionId,
      {
        executionHash,

        settlementHash,

        emergencySettlementHash:
          settlementHash,

        positionMetadataHash:
          "0x" + "aa".repeat(32),

        maturity:
          plannedMaturity,

        emergencyMinReturn:
          principal,
      }
    )
  );

  // ------------------------------------------------------------------
  // Execute
  // ------------------------------------------------------------------

  await waitTx(
    "Confluence.execute Notes draw",
    await conf.execute(
      positionId,
      [drawCall]
    )
  );

  log.info(
    {
      noteId:
        noteId.toString(),

      positionId:
        positionId.toString(),

      principal:
        principal.toString(),
    },
    "Notes loan funded"
  );

  // ------------------------------------------------------------------
  // Read actual Notes maturity
  // ------------------------------------------------------------------

  const note =
    await notes.notes(noteId);

  const actualMaturity =
    BigInt(note.maturity);

  log.info(
    {
      plannedMaturity:
        plannedMaturity.toString(),

      actualMaturity:
        actualMaturity.toString(),
    },
    "Actual Notes maturity"
  );

  // ------------------------------------------------------------------
  // Repayment funds
  // ------------------------------------------------------------------

  const repayment =
    principal + interest;

  await waitTx(
    "mint USDC repayment",
    await usdc.mint(
      address,
      repayment
    )
  );

  await waitTx(
    "approve Notes repayment",
    await usdc.approve(
      c.notes,
      repayment
    )
  );

  // ------------------------------------------------------------------
  // Wait for actual Notes maturity
  // ------------------------------------------------------------------

  while (true) {
    const block =
      await wallet.provider!.getBlock(
        "latest"
      );

    if (!block)
      throw new Error(
        "Unable to read latest block"
      );

    const current =
      BigInt(block.timestamp);

    if (current >= actualMaturity)
      break;

    const remaining =
      Number(
        actualMaturity - current
      );

    const waitSeconds =
      Math.min(
        Math.max(remaining, 1),
        15
      );

    log.info(
      {
        current:
          current.toString(),

        maturity:
          actualMaturity.toString(),

        waitSeconds,
      },
      "Waiting for Notes maturity"
    );

    await sleep(
      waitSeconds * 1000
    );
  }

  // ------------------------------------------------------------------
  // Deposit repayment
  // ------------------------------------------------------------------

  await waitTx(
    "borrower repays 1000 + 10 USDC",
    await notes.depositRepayment(
      noteId
    )
  );

  log.info(
    {
      noteId:
        noteId.toString(),

      repayment:
        repayment.toString(),
    },
    "Notes repayment deposited"
  );

  

  // ------------------------------------------------------------------
  // Save state
  // ------------------------------------------------------------------

  d.notesAccountIds =
    accountIds.map(String);

  d.notesMandateIds =
    mandateIds.map(String);

  d.notesNoteId =
    noteId.toString();

  d.notesOpportunityId =
    opportunityId.toString();

  d.notesPositionId =
    positionId.toString();

  saveDeployment(d);

  log.info(
    {
      noteId:
        noteId.toString(),

      opportunityId:
        opportunityId.toString(),

      positionId:
        positionId.toString(),
    },
    "Notes E2E completed successfully"
  );
}

main().catch((err) => {
  log.error(
    { err },
    "Notes E2E failed"
  );

  process.exit(1);
});
