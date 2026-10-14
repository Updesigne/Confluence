import "dotenv/config";

import { Contract, Interface, parseUnits } from "ethers";

import { loadArtifact } from "./lib/artifacts";
import { wallet } from "./lib/env";
import { eventArg } from "./lib/events";
import { log, sleep, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";

async function main() {
  // ------------------------------------------------------------------
  // Args: <accountId> <mandateId>
  // ------------------------------------------------------------------
  const accountArg = process.argv[2];
  const mandateArg = process.argv[3];

  if (!accountArg || !mandateArg) {
    console.error(
      "Usage: tsx scripts/03-usdg-depeg-e2e.ts <accountId> <mandateId>"
    );
    process.exit(1);
  }

  const accountId = BigInt(accountArg);
  const mandateId = BigInt(mandateArg);

  const d = loadDeployment();
  const c = d.contracts;
  const abi = (name: string) => loadArtifact(name).abi;

  const conf = new Contract(c.confluenceUSDG, abi("Confluence"), wallet);
  const opp = new Contract(c.opportunities, abi("OpportunityRegistry"), wallet);
  const router = new Contract(c.router, abi("ExecutionRouter"), wallet);
  const pool = new Contract(c.pool, abi("MockUSDGPool"), wallet);
  const usdg = new Contract(c.usdg, abi("MockUSDG"), wallet);
  const adapter = new Contract(c.usdgAdapter, abi("USDGDepegAdapter"), wallet);
  const vault = new Contract(c.vaultUSDG, abi("CapitalVault"), wallet);
  const mandates = new Contract(c.mandatesUSDG, abi("MandateRegistry"), wallet);

  const confluenceInterface = new Interface(abi("Confluence"));

  const principal = parseUnits("1000", 6);

  // ------------------------------------------------------------------
  // Pre-flight: validate account + mandate
  // ------------------------------------------------------------------
  const account = await vault.account(accountId);
  if (!account.active) {
    throw new Error(`Account ${accountId} is not active`);
  }
  if (BigInt(account.available) < principal) {
    throw new Error(
      `Account ${accountId} has only ${account.available.toString()} available, ` +
      `needs ${principal.toString()}`
    );
  }

  const mandate = await mandates.getMandate(mandateId);
  if (BigInt(mandate.id) === 0n) {
    throw new Error(`Mandate ${mandateId} does not exist`);
  }
  if (!mandate.active) {
    throw new Error(`Mandate ${mandateId} is not active`);
  }
  if (mandate.asset !== c.usdg) {
    throw new Error(
      `Mandate ${mandateId}.asset is ${mandate.asset}, expected USDG ${c.usdg}`
    );
  }

  const venueOk: boolean = await mandates.isVenueAllowed(mandateId, c.pool);
  if (!venueOk) {
    throw new Error(
      `Mandate ${mandateId} does not allow pool venue ${c.pool}`
    );
  }

  log.info(
    {
      wallet: await wallet.getAddress(),
      accountId: accountId.toString(),
      available: account.available.toString(),
      mandateId: mandateId.toString(),
      mandateAsset: mandate.asset,
      mandateMaxAllocation: mandate.maxAllocation.toString(),
      mandateMinDuration: mandate.minDuration.toString(),
      mandateMaxDuration: mandate.maxDuration.toString(),
      principal: principal.toString(),
    },
    "Pre-flight checks passed"
  );

  // ------------------------------------------------------------------
  // Opportunity deadline: just needs to be well in the future so that
  // reserve() succeeds during addParticipant. 30 minutes is plenty.
  // ------------------------------------------------------------------
  const initialBlock = await wallet.provider!.getBlock("latest");
  if (!initialBlock) throw new Error("Unable to read latest block");

  const initialNow = initialBlock.timestamp;
  const opportunityDeadline = initialNow + 30 * 60; // 30 minutes

  log.info({ initialNow, opportunityDeadline }, "Opportunity deadline set");

  // ------------------------------------------------------------------
  // 1. Set the USDG pool price to the depeg price.
  // ------------------------------------------------------------------
  await waitTx("set USDG price to 1.003", await pool.setPrice(1_003_000n));

  // ------------------------------------------------------------------
  // 2. Create USDG depeg opportunity.
  // ------------------------------------------------------------------
  await waitTx(
    "create USDG depeg opportunity",
    await opp.createOpportunity({
      asset: c.usdg,
      venue: c.pool,
      adapter: c.usdgAdapter,
      capacity: principal,
      duration: 20,
      liquidityBps: 0,
      riskClass: 0,
      usesLeverage: false,
      minReturn: principal,
      deadline: opportunityDeadline,
      metadataHash: "0x" + "33".repeat(32),
      venueRefId: 0,
    })
  );

  const opportunityId = (await opp.nextOpportunityId()) - 1n;

  log.info(
    { opportunityId: opportunityId.toString() },
    "USDG opportunity created"
  );

  // ------------------------------------------------------------------
  // FRESH TIMESTAMP: measured from here so the pre-execute phase fits.
  //
  // We fire FOUR txs before execute lands:
  //   create -> addParticipant -> lockPlan -> execute
  //
  // On Arbitrum Sepolia each mines in ~5-15s, so ~180s covers the
  // worst case with headroom. maturity sits 60s past the exec window
  // so the post-execute wait stays short while leaving room for the
  // chain clock to advance.
  // ------------------------------------------------------------------
  const freshBlock = await wallet.provider!.getBlock("latest");
  if (!freshBlock) throw new Error("Unable to read latest block");
  const freshNow = freshBlock.timestamp;

  const executionDeadline = freshNow + 180; // 3 min -- covers 4 txs comfortably
  const maturity = freshNow + 240;          // 60s after exec window closes
  const settlementDeadline = freshNow + 900; // 15 min safety margin

  log.info(
    {
      freshNow,
      executionDeadline,
      maturity,
      settlementDeadline,
      postExecuteWindow: maturity - executionDeadline,
    },
    "Execution window (fresh timestamps)"
  );

  // ------------------------------------------------------------------
  // 3. Create Confluence position and capture its ID from the event.
  // ------------------------------------------------------------------
  const positionReceipt = await waitTx(
    "Confluence.create USDG",
    await conf.create(
      opportunityId,
      principal,
      principal,
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

  log.info(
    { positionId: positionId.toString() },
    "Confluence position created"
  );

  // ------------------------------------------------------------------
  // 4. Add the seeded vault participant.
  // ------------------------------------------------------------------
  await waitTx(
    `Confluence.addParticipant account ${accountId}`,
    await conf.addParticipant(positionId, accountId, mandateId, principal)
  );

  // ------------------------------------------------------------------
  // 5. Prepare execution calls.
  // ------------------------------------------------------------------
  const executionCalls = [
    {
      target: c.usdg,
      value: 0n,
      data: usdg.interface.encodeFunctionData("approve", [
        c.usdgAdapter,
        principal,
      ]),
    },
    {
      target: c.usdgAdapter,
      value: 0n,
      data: adapter.interface.encodeFunctionData("open", [
        principal,
        principal,
      ]),
    },
  ];

  const executionHash = await router.hashCalls(executionCalls);

  // ------------------------------------------------------------------
  // 6. Determine the hedge ID that will be created by adapter.open().
  // ------------------------------------------------------------------
  const hedgeId = await adapter.nextHedgeId();

  log.info({ hedgeId: hedgeId.toString() }, "prepared USDG hedge");

  // ------------------------------------------------------------------
  // 7. Prepare settlement calls.
  // ------------------------------------------------------------------
  const settlementCalls = [
    {
      target: c.usdgAdapter,
      value: 0n,
      data: adapter.interface.encodeFunctionData("close", [
        hedgeId,
        principal,
      ]),
    },
  ];

  const settlementHash = await router.hashCalls(settlementCalls);

  // ------------------------------------------------------------------
  // 8. Pre-flight window check before lockPlan.
  //
  // lockPlan reverts with Invalid() if block.timestamp > executionDeadline.
  // If that happened, we want a clear error rather than an opaque selector.
  // ------------------------------------------------------------------
  const beforeLock = await wallet.provider!.getBlock("latest");
  if (!beforeLock) throw new Error("Unable to read latest block");
  const nowBeforeLock = BigInt(beforeLock.timestamp);
  const execDeadlineBig = BigInt(executionDeadline);

  if (nowBeforeLock > execDeadlineBig) {
    throw new Error(
      `Execution window already closed before lockPlan: ` +
      `now=${nowBeforeLock}, executionDeadline=${executionDeadline}. ` +
      `The chain clock advanced ${Number(
        nowBeforeLock - BigInt(freshNow)
      )}s since freshNow was read. Increase the +180 offset.`
    );
  }

  log.info(
    {
      nowBeforeLock: nowBeforeLock.toString(),
      executionDeadline: executionDeadline.toString(),
      remainingSeconds: Number(execDeadlineBig - nowBeforeLock),
    },
    "Pre-lockPlan window check"
  );

  // ------------------------------------------------------------------
  // 9. Lock the execution/settlement plan.
  // ------------------------------------------------------------------
  await waitTx(
    "Confluence.lockPlan USDG",
    await conf.lockPlan(positionId, {
      executionHash,
      settlementHash,
      emergencySettlementHash: settlementHash,
      positionMetadataHash: "0x" + "44".repeat(32),
      maturity,
      emergencyMinReturn: principal,
    })
  );

  // ------------------------------------------------------------------
  // 10. Execute the USDG depeg strategy.
  // ------------------------------------------------------------------
  const beforeExecute = await wallet.provider!.getBlock("latest");
  if (!beforeExecute) {
    throw new Error("Unable to read latest block before execution");
  }

  log.info(
    {
      currentTimestamp: beforeExecute.timestamp,
      executionDeadline,
      remainingSeconds: executionDeadline - beforeExecute.timestamp,
    },
    "executing USDG depeg"
  );

  if (beforeExecute.timestamp > executionDeadline) {
    throw new Error(
      `Execution deadline already expired: ` +
      `${beforeExecute.timestamp} > ${executionDeadline}. ` +
      `Increase executionDeadline offset (currently +180s).`
    );
  }

  await waitTx(
    "Confluence.execute USDG depeg",
    await conf.execute(positionId, executionCalls)
  );

  log.info("USDG depeg position executed");

  // ------------------------------------------------------------------
  // 11. Wait until Confluence maturity.
  // ------------------------------------------------------------------
  const afterExecute = await wallet.provider!.getBlock("latest");
  if (!afterExecute) {
    throw new Error("Unable to read latest block after execution");
  }

  const remainingUntilMaturity = Math.max(
    0,
    maturity - afterExecute.timestamp
  );

  log.info(
    {
      currentTimestamp: afterExecute.timestamp,
      maturity,
      remainingSeconds: remainingUntilMaturity,
    },
    "waiting for USDG maturity"
  );

  if (remainingUntilMaturity > 0) {
    await sleep(remainingUntilMaturity * 1000 + 500);
  }

  // ------------------------------------------------------------------
  // 12. Repeg the pool.
  // ------------------------------------------------------------------
  await waitTx("repeg pool to 1.000", await pool.setPrice(1_000_000n));

  // ------------------------------------------------------------------
  // 13. Verify maturity before settlement.
  // ------------------------------------------------------------------
  const beforeSettle = await wallet.provider!.getBlock("latest");
  if (!beforeSettle) {
    throw new Error("Unable to read latest block before settlement");
  }

  log.info(
    {
      currentTimestamp: beforeSettle.timestamp,
      maturity,
      settlementDeadline,
    },
    "settling USDG position"
  );

  if (beforeSettle.timestamp < maturity) {
    const extraWait = maturity - beforeSettle.timestamp;
    await sleep(extraWait * 1000 + 500);
  }

  if (beforeSettle.timestamp > settlementDeadline) {
    throw new Error(
      `Settlement deadline expired: ` +
      `${beforeSettle.timestamp} > ${settlementDeadline}`
    );
  }

  // ------------------------------------------------------------------
  // 14. Settle Confluence position.
  // ------------------------------------------------------------------
  await waitTx(
    "Confluence.settle USDG",
    await conf.settle(positionId, settlementCalls)
  );

  // ------------------------------------------------------------------
  // 15. Read final position state.
  // ------------------------------------------------------------------
  const p = await conf.positions(positionId);

  log.info(
    {
      positionId: positionId.toString(),
      returnedTotal: p.returnedTotal.toString(),
      totalPrincipal: p.totalPrincipal.toString(),
      minReturn: p.minReturn.toString(),
      status: p.status.toString(),
    },
    "USDG opportunity settled"
  );

  log.info("USDG DEPEG E2E COMPLETED SUCCESSFULLY");
}

main().catch((err) => {
  log.error({ err }, "USDG E2E failed");
  process.exit(1);
});