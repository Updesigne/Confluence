
import "dotenv/config";

import { Contract, parseUnits } from "ethers";

import { loadArtifact } from "./lib/artifacts";
import { wallet } from "./lib/env";
import { log, sleep, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";

async function main() {
  const d = loadDeployment();
  const c = d.contracts;

  if (!d.usdgAccountId || !d.usdgMandateId) {
    throw new Error("Run pnpm seed:usdg first");
  }

  const abi = (name: string) => loadArtifact(name).abi;

  const conf = new Contract(
    c.confluenceUSDG,
    abi("Confluence"),
    wallet,
  );

  const opp = new Contract(
    c.opportunities,
    abi("OpportunityRegistry"),
    wallet,
  );

  const router = new Contract(
    c.router,
    abi("ExecutionRouter"),
    wallet,
  );

  const pool = new Contract(
    c.pool,
    abi("MockUSDGPool"),
    wallet,
  );

  const usdg = new Contract(
    c.usdg,
    abi("MockUSDG"),
    wallet,
  );

  const adapter = new Contract(
    c.usdgAdapter,
    abi("USDGDepegAdapter"),
    wallet,
  );

  const principal = parseUnits("1000", 6);

  /*
   * IMPORTANT:
   *
   * Do not calculate all deadlines from an old block timestamp.
   *
   * Deployment + opportunity creation + participant registration +
   * plan locking can take several blocks.
   *
   * We therefore create the opportunity first and calculate the
   * execution/settlement windows from a fresh timestamp.
   */

  const initialBlock = await wallet.provider!.getBlock("latest");

  if (!initialBlock) {
    throw new Error("Unable to read latest block");
  }

  const initialNow = initialBlock.timestamp;

  // Large enough windows for Arbitrum Sepolia E2E transactions.
  const opportunityDeadline = initialNow + 30 * 60; // 30 minutes
  const executionDeadline = initialNow + 10 * 60;   // 10 minutes
  const maturity = initialNow + 11 * 60;            // 11 minutes
  const settlementDeadline = initialNow + 20 * 60;  // 20 minutes

  log.info(
    {
      initialNow,
      opportunityDeadline,
      executionDeadline,
      maturity,
      settlementDeadline,
    },
    "USDG E2E deadlines",
  );

  // ---------------------------------------------------------------------------
  // 1. Set the USDG pool price to the depeg price.
  // ---------------------------------------------------------------------------

  await waitTx(
    "set USDG price to 1.003",
    await pool.setPrice(1_003_000n),
  );

  // ---------------------------------------------------------------------------
  // 2. Create USDG depeg opportunity.
  // ---------------------------------------------------------------------------

  await waitTx(
    "create USDG depeg opportunity",
    await opp.createOpportunity({
      asset: c.usdg,
      venue: c.pool,
      adapter: c.usdgAdapter,

      capacity: principal,

      // This is the strategy duration used for opportunity/mandate checks.
      duration: 20,

      liquidityBps: 0,
      riskClass: 0,
      usesLeverage: false,

      minReturn: principal,

      deadline: opportunityDeadline,

      metadataHash: "0x" + "33".repeat(32),

      venueRefId: 0,
    }),
  );

  const opportunityId =
    (await opp.nextOpportunityId()) - 1n;

  log.info(
    {
      opportunityId: opportunityId.toString(),
    },
    "USDG opportunity created",
  );

  // ---------------------------------------------------------------------------
  // 3. Create Confluence position.
  // ---------------------------------------------------------------------------

  await waitTx(
    "Confluence.create USDG",
    await conf.create(
      opportunityId,
      principal,
      principal,
      executionDeadline,
      settlementDeadline,
    ),
  );

  // ---------------------------------------------------------------------------
  // 4. Add the seeded vault participant.
  // ---------------------------------------------------------------------------

  await waitTx(
    "Confluence.addParticipant USDG",
    await conf.addParticipant(
      1n,
      BigInt(d.usdgAccountId),
      BigInt(d.usdgMandateId),
      principal,
    ),
  );

  // ---------------------------------------------------------------------------
  // 5. Prepare execution calls.
  //
  // Router executes these calls.
  //
  // 1. Router approves USDGAdapter to spend USDG.
  // 2. Router calls USDGAdapter.open().
  // ---------------------------------------------------------------------------

  const executionCalls = [
    {
      target: c.usdg,
      value: 0n,
      data: usdg.interface.encodeFunctionData(
        "approve",
        [
          c.usdgAdapter,
          principal,
        ],
      ),
    },
    {
      target: c.usdgAdapter,
      value: 0n,
      data: adapter.interface.encodeFunctionData(
        "open",
        [
          principal,
          principal,
        ],
      ),
    },
  ];

  const executionHash =
    await router.hashCalls(executionCalls);

  // ---------------------------------------------------------------------------
  // 6. Determine the hedge ID that will be created by adapter.open().
  //
  // nextHedgeId returns the ID that the next open() will use.
  // ---------------------------------------------------------------------------

  const hedgeId = await adapter.nextHedgeId();

  log.info(
    {
      hedgeId: hedgeId.toString(),
    },
    "prepared USDG hedge",
  );

  // ---------------------------------------------------------------------------
  // 7. Prepare settlement calls.
  // ---------------------------------------------------------------------------

  const settlementCalls = [
    {
      target: c.usdgAdapter,
      value: 0n,
      data: adapter.interface.encodeFunctionData(
        "close",
        [
          hedgeId,
          principal,
        ],
      ),
    },
  ];

  const settlementHash =
    await router.hashCalls(settlementCalls);

  // ---------------------------------------------------------------------------
  // 8. Lock the execution/settlement plan.
  // ---------------------------------------------------------------------------

  await waitTx(
    "Confluence.lockPlan USDG",
    await conf.lockPlan(
      1n,
      {
        executionHash,

        settlementHash,

        emergencySettlementHash:
          settlementHash,

        positionMetadataHash:
          "0x" + "44".repeat(32),

        maturity,

        emergencyMinReturn:
          principal,
      },
    ),
  );

  // ---------------------------------------------------------------------------
  // 9. Execute the USDG depeg strategy.
  //
  // We now have a 10-minute execution window instead of 30 seconds.
  // ---------------------------------------------------------------------------

  const beforeExecute =
    await wallet.provider!.getBlock("latest");

  if (!beforeExecute) {
    throw new Error(
      "Unable to read latest block before execution",
    );
  }

  log.info(
    {
      currentTimestamp: beforeExecute.timestamp,
      executionDeadline,
      remainingSeconds:
        executionDeadline - beforeExecute.timestamp,
    },
    "executing USDG depeg",
  );

  if (beforeExecute.timestamp > executionDeadline) {
    throw new Error(
      `Execution deadline already expired: ` +
      `${beforeExecute.timestamp} > ${executionDeadline}`,
    );
  }

  await waitTx(
    "Confluence.execute USDG depeg",
    await conf.execute(
      1n,
      executionCalls,
    ),
  );

  log.info(
    "USDG depeg position executed",
  );

  // ---------------------------------------------------------------------------
  // 10. Wait until Confluence maturity.
  //
  // Do NOT use a fixed 20-second sleep.
  //
  // Maturity is an on-chain timestamp and must actually be reached.
  // ---------------------------------------------------------------------------

  const afterExecute =
    await wallet.provider!.getBlock("latest");

  if (!afterExecute) {
    throw new Error(
      "Unable to read latest block after execution",
    );
  }

  const remainingUntilMaturity =
    Math.max(
      0,
      maturity - afterExecute.timestamp,
    );

  log.info(
    {
      currentTimestamp: afterExecute.timestamp,
      maturity,
      remainingSeconds: remainingUntilMaturity,
    },
    "waiting for USDG maturity",
  );

  if (remainingUntilMaturity > 0) {
    await sleep(
      remainingUntilMaturity * 1000 + 5_000,
    );
  }

  // ---------------------------------------------------------------------------
  // 11. Repeg the pool.
  // ---------------------------------------------------------------------------

  await waitTx(
    "repeg pool to 1.000",
    await pool.setPrice(1_000_000n),
  );

  // ---------------------------------------------------------------------------
  // 12. Verify maturity before settlement.
  // ---------------------------------------------------------------------------

  const beforeSettle =
    await wallet.provider!.getBlock("latest");

  if (!beforeSettle) {
    throw new Error(
      "Unable to read latest block before settlement",
    );
  }

  log.info(
    {
      currentTimestamp: beforeSettle.timestamp,
      maturity,
      settlementDeadline,
    },
    "settling USDG position",
  );

  if (beforeSettle.timestamp < maturity) {
    const extraWait =
      maturity - beforeSettle.timestamp;

    await sleep(
      extraWait * 1000 + 5_000,
    );
  }

  if (beforeSettle.timestamp > settlementDeadline) {
    throw new Error(
      `Settlement deadline expired: ` +
      `${beforeSettle.timestamp} > ${settlementDeadline}`,
    );
  }

  // ---------------------------------------------------------------------------
  // 13. Settle Confluence position.
  // ---------------------------------------------------------------------------

  await waitTx(
    "Confluence.settle USDG",
    await conf.settle(
      1n,
      settlementCalls,
    ),
  );

  // ---------------------------------------------------------------------------
  // 14. Read final position state.
  // ---------------------------------------------------------------------------

  const p = await conf.positions(1n);

  log.info(
    {
      returnedTotal:
        p.returnedTotal.toString(),

      totalPrincipal:
        p.totalPrincipal.toString(),

      minReturn:
        p.minReturn.toString(),

      status:
        p.status.toString(),
    },
    "USDG opportunity settled",
  );

  log.info(
    "USDG DEPEG E2E COMPLETED SUCCESSFULLY",
  );
}

main().catch((err) => {
  log.error(
    {
      err,
    },
    "USDG E2E failed",
  );

  process.exit(1);
});
