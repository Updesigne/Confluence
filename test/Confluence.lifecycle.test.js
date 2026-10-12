// test/Confluence.lifecycle.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ---------- constants ----------
const DAY = 24n * 60n * 60n;
const HOUR = 60n * 60n;
const usdg = (n) => ethers.parseUnits(n.toString(), 6);
const usdc = (n) => ethers.parseUnits(n.toString(), 6);
const weth = (n) => ethers.parseUnits(n.toString(), 18);
const priceE8 = (n) => ethers.parseUnits(n.toString(), 8);
const ZERO_HASH = ethers.ZeroHash;

const Status = {
  FORMING: 0n, PLAN_LOCKED: 1n, EXECUTED: 2n,
  SETTLED: 3n, EMERGENCY_EXIT: 4n, CANCELLED: 5n,
};
const OppStatus = { OPEN: 0n, EXECUTED: 1n, CLOSED: 2n, CANCELLED: 3n };
const NoteStatus = {
  OPEN: 0n, FUNDED: 1n, REPAID: 2n,
  DEFAULTED: 3n, LIQUIDATED: 4n, CANCELLED: 5n,
};

// ---------- struct helpers ----------

function plan(
  executionHash,
  settlementHash,
  emergencySettlementHash,
  maturity,
  emergencyMinReturn,
  positionMetadataHash = ZERO_HASH
) {
  return {
    executionHash,
    settlementHash,
    emergencySettlementHash,
    positionMetadataHash,
    maturity,
    emergencyMinReturn,
  };
}

// `venues` is the initial allowlist. Empty array = any venue.
function mandate({
  accountId,
  asset,
  venues = [],
  maxAllocation,
  minDuration,
  maxDuration,
  minLiquidityBps = 5000,
  maxRiskClass = 1,
  leverageAllowed = false,
  purposeHash = ZERO_HASH,
  policyHash = ZERO_HASH,
}) {
  return {
    accountId,
    asset,
    initialVenues: venues,
    maxAllocation,
    minDuration,
    maxDuration,
    minLiquidityBps,
    maxRiskClass,
    leverageAllowed,
    purposeHash,
    policyHash,
  };
}

function opportunity({
  asset,
  venue,
  adapter,
  capacity,
  duration,
  liquidityBps = 5000,
  riskClass = 1,
  usesLeverage = false,
  minReturn,
  deadline,
  metadataHash = ZERO_HASH,
  venueRefId = 0n,
}) {
  return {
    asset,
    venue,
    adapter,
    capacity,
    duration,
    liquidityBps,
    riskClass,
    usesLeverage,
    minReturn,
    deadline,
    metadataHash,
    venueRefId,
  };
}

// =====================================================================
// FIXTURE
// =====================================================================
async function deployFixture() {
  const [owner, alice, bob, borrower, liquidator, watcher, outsider] =
    await ethers.getSigners();

  // -------- tokens --------
  const MockUSDG = await ethers.getContractFactory("MockUSDG");
  const usdgToken = await MockUSDG.deploy();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdcToken = await MockUSDC.deploy();

  const MockWETH = await ethers.getContractFactory("MockWETH");
  const wethToken = await MockWETH.deploy();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const priceFeed = await MockPriceFeed.deploy(priceE8(2000));

  // -------- execution layer --------
  const AdapterRegistry = await ethers.getContractFactory("AdapterRegistry");
  const adapterRegistry = await AdapterRegistry.deploy();

  const ExecutionRouter = await ethers.getContractFactory("ExecutionRouter");
  const router = await ExecutionRouter.deploy(await adapterRegistry.getAddress());

  // -------- core --------
  const CapitalVault = await ethers.getContractFactory("CapitalVault");
  const vault = await CapitalVault.deploy(await usdgToken.getAddress());

  const MandateRegistry = await ethers.getContractFactory("MandateRegistry");
  const mandates = await MandateRegistry.deploy(await vault.getAddress());

  const OpportunityRegistry = await ethers.getContractFactory("OpportunityRegistry");
  const opportunities = await OpportunityRegistry.deploy();

  // -------- coordination --------
  const Confluence = await ethers.getContractFactory("Confluence");
  const confluence = await Confluence.deploy(
    await vault.getAddress(),
    await mandates.getAddress(),
    await opportunities.getAddress(),
    await router.getAddress()
  );

  // -------- venues --------
  const Notes = await ethers.getContractFactory("Notes");
  const notes = await Notes.deploy(
    await usdgToken.getAddress(),
    await wethToken.getAddress(),
    await priceFeed.getAddress(),
    30n * DAY
  );

  const MockVenue = await ethers.getContractFactory("MockVenue");
  const mockVenue = await MockVenue.deploy();

  // USDG/USDC mock pool + depeg adapter
  const MockUSDGPool = await ethers.getContractFactory("MockUSDGPool");
  const pool = await MockUSDGPool.deploy(
    await usdgToken.getAddress(),
    await usdcToken.getAddress(),
    1_000_000n,
    usdg(5_000_000)
  );

  const USDGDepegAdapter = await ethers.getContractFactory("USDGDepegAdapter");
  const depegAdapter = await USDGDepegAdapter.deploy(
    await usdgToken.getAddress(),
    await usdcToken.getAddress(),
    await pool.getAddress()
  );

  // -------- addresses --------
  const usdgAddr  = await usdgToken.getAddress();
  const usdcAddr  = await usdcToken.getAddress();
  const wethAddr  = await wethToken.getAddress();
  const notesAddr = await notes.getAddress();
  const venueAddr = await mockVenue.getAddress();
  const poolAddr  = await pool.getAddress();
  const depegAddr = await depegAdapter.getAddress();
  const adapter   = owner.address; // generic adapter slot for MockVenue/Notes

  // -------- permissions --------
  await vault.setModule(await confluence.getAddress(), true);
  await mandates.setModule(await confluence.getAddress(), true);
  await opportunities.setModule(await confluence.getAddress(), true);
  await router.setCaller(await confluence.getAddress(), true);
  await notes.setRouter(await router.getAddress());
  await opportunities.setPublisher(owner.address, true);
  await opportunities.setPublisher(watcher.address, true);

  // -------- AdapterRegistry: MockVenue --------
  await adapterRegistry.setAdapter(adapter, venueAddr, true);
  await router.setGlobalTarget(venueAddr, true);
  await adapterRegistry.setSelector(adapter, venueAddr, usdgAddr,
    usdgToken.interface.getFunction("approve").selector, true);
  await adapterRegistry.setSelector(adapter, venueAddr, venueAddr,
    mockVenue.interface.getFunction("deposit").selector, true);
  await adapterRegistry.setSelector(adapter, venueAddr, venueAddr,
    mockVenue.interface.getFunction("redeem").selector, true);
  await adapterRegistry.setSelector(adapter, venueAddr, venueAddr,
    mockVenue.interface.getFunction("emergencyRedeem").selector, true);

  // -------- AdapterRegistry: Notes --------
  await adapterRegistry.setAdapter(adapter, notesAddr, true);
  await router.setGlobalTarget(notesAddr, true);
  await adapterRegistry.setSelector(adapter, notesAddr, usdgAddr,
    usdgToken.interface.getFunction("transfer").selector, true);
  await adapterRegistry.setSelector(adapter, notesAddr, notesAddr,
    notes.interface.getFunction("draw").selector, true);
  await adapterRegistry.setSelector(adapter, notesAddr, notesAddr,
    notes.interface.getFunction("markRepaid").selector, true);
  await adapterRegistry.setSelector(adapter, notesAddr, notesAddr,
    notes.interface.getFunction("liquidate").selector, true);

  // -------- AdapterRegistry: USDGDepegAdapter --------
  await adapterRegistry.setAdapter(depegAddr, depegAddr, true);
  await router.setGlobalTarget(depegAddr, true);
  await adapterRegistry.setSelector(depegAddr, depegAddr, usdgAddr,
    usdgToken.interface.getFunction("approve").selector, true);
  await adapterRegistry.setSelector(depegAddr, depegAddr, depegAddr,
    depegAdapter.interface.getFunction("open").selector, true);
  await adapterRegistry.setSelector(depegAddr, depegAddr, depegAddr,
    depegAdapter.interface.getFunction("close").selector, true);

  // -------- pool seeding --------
  await usdgToken.mint(poolAddr, usdg(5_000_000));
  await usdcToken.mint(poolAddr, usdc(5_000_000));

  // -------- fund actors --------
  await usdgToken.mint(alice.address, usdg(500_000));
  await usdgToken.mint(bob.address, usdg(500_000));
  await usdgToken.mint(borrower.address, usdg(500_000));
  await usdgToken.mint(owner.address, usdg(500_000));
  await wethToken.mint(borrower.address, weth(100));

  return {
    owner, alice, bob, borrower, liquidator, watcher, outsider,
    usdgToken, usdcToken, wethToken, priceFeed,
    adapterRegistry, router, vault, mandates, opportunities, confluence,
    notes, mockVenue, pool, depegAdapter,
    adapter, usdgAddr, usdcAddr, wethAddr, notesAddr, venueAddr, poolAddr, depegAddr,
  };
}

// =====================================================================
describe("Confluence Protocol — Full Lifecycle", function () {
  // -------------------------------------------------------------------
  describe("Deployment", function () {
    it("wires permissions correctly", async function () {
      const { vault, mandates, opportunities, confluence, router, notes } =
        await loadFixture(deployFixture);
      expect(await vault.module(await confluence.getAddress())).to.equal(true);
      expect(await mandates.module(await confluence.getAddress())).to.equal(true);
      expect(await opportunities.module(await confluence.getAddress())).to.equal(true);
      expect(await router.caller(await confluence.getAddress())).to.equal(true);
      expect(await notes.router()).to.equal(await router.getAddress());
    });

    it("seeds the pool with liquidity at par", async function () {
      const { pool, usdgToken, usdcToken, poolAddr } = await loadFixture(deployFixture);
      const [price, depth] = await pool.quote();
      expect(price).to.equal(1_000_000n);
      expect(depth).to.equal(usdg(5_000_000));
      expect(await usdgToken.balanceOf(poolAddr)).to.equal(usdg(5_000_000));
      expect(await usdcToken.balanceOf(poolAddr)).to.equal(usdc(5_000_000));
    });
  });

  // -------------------------------------------------------------------
  describe("MockVenue happy path", function () {
    async function setup() {
      const ctx = await loadFixture(deployFixture);
      const { alice, bob, usdgToken, vault, mandates,
              opportunities, confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1,
        asset: usdgAddr,
        venues: [venueAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY,
        maxDuration: 60n * DAY,
      }));

      await vault.connect(bob).createAccount();
      await usdgToken.connect(bob).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(bob).deposit(2, usdg(50_000));
      await mandates.connect(bob).createMandate(mandate({
        accountId: 2,
        asset: usdgAddr,
        venues: [venueAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY,
        maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      const oppDuration = 30n * DAY;
      const capacity = usdg(100_000);
      const minReturn = usdg(100_000);

      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr,
        venue: venueAddr,
        adapter,
        capacity,
        duration: oppDuration,
        minReturn,
        deadline: now + 2n * DAY,
      }));

      await confluence.create(1, capacity, minReturn, now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      return { ...ctx, oppDuration, capacity, minReturn, now };
    }

    it("executes, settles and distributes profit pro-rata", async function () {
      const ctx = await setup();
      const { oppDuration, now, usdgToken, vault, confluence, router,
              mockVenue, usdgAddr, venueAddr, alice, opportunities } = ctx;

      await usdgToken.mint(venueAddr, usdg(1000));

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(100_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(100_000), oppDuration, 100n]) },
      ];
      const settleCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "redeem", [1n]) },
      ];
      const emergCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "emergencyRedeem", [1n, 100n, await router.getAddress()]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(emergCalls),
        now + oppDuration,
        usdg(90_000)
      ));
      await confluence.execute(1, execCalls);

      expect((await vault.account(1)).deployed).to.equal(usdg(50_000));
      expect((await vault.account(2)).deployed).to.equal(usdg(50_000));
      expect(await usdgToken.balanceOf(venueAddr)).to.equal(usdg(101_000));

      await time.increase(oppDuration + 100n);
      await confluence.settle(1, settleCalls);

      expect((await vault.account(1)).available).to.equal(usdg(50_500));
      expect((await vault.account(1)).deployed).to.equal(0n);
      expect((await vault.account(2)).available).to.equal(usdg(50_500));
      expect((await vault.account(2)).deployed).to.equal(0n);

      expect((await opportunities.getOpportunity(1)).status).to.equal(OppStatus.CLOSED);

      await vault.connect(alice).withdraw(1, usdg(50_500));
      expect(await usdgToken.balanceOf(alice.address))
        .to.equal(usdg(500_000 - 50_000 + 50_500));
    });

    it("emits the full event chain", async function () {
      const ctx = await setup();
      const { oppDuration, now, usdgToken, confluence, router, mockVenue,
              usdgAddr, venueAddr, vault } = ctx;

      await usdgToken.mint(venueAddr, usdg(1000));

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(100_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(100_000), oppDuration, 100n]) },
      ];
      const settleCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "redeem", [1n]) },
      ];
      const emergCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "emergencyRedeem", [1n, 100n, await router.getAddress()]) },
      ];

      await expect(
        confluence.lockPlan(1, plan(
          await router.hashCalls(execCalls),
          await router.hashCalls(settleCalls),
          await router.hashCalls(emergCalls),
          now + oppDuration,
          usdg(90_000)
        ))
      ).to.emit(confluence, "PlanLocked");

      await expect(confluence.execute(1, execCalls))
        .to.emit(confluence, "Executed")
        .and.to.emit(router, "MulticallExecuted");

      await time.increase(oppDuration + 100n);

      await expect(confluence.settle(1, settleCalls))
        .to.emit(confluence, "Settled")
        .and.to.emit(confluence, "Realized")
        .and.to.emit(vault, "SettlementReceived");
    });
  });

  // -------------------------------------------------------------------
  describe("Notes loan lifecycle", function () {
    it("funds a Notes loan and returns principal + interest", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, bob, borrower, usdgToken, wethToken, vault, mandates,
              opportunities, confluence, router, notes, adapter,
              usdgAddr, notesAddr } = ctx;

      const requested = usdg(100_000);
      const interest  = usdg(2000);
      const collateralAmount = weth(70);
      const duration  = 30n * DAY;

      await wethToken.connect(borrower).approve(notesAddr, collateralAmount);
      await notes.connect(borrower).createNote(
        requested, collateralAmount, interest, duration, ZERO_HASH, ZERO_HASH
      );

      const now = BigInt(await time.latest());
      const capacity  = requested + interest;
      const minReturn = requested + interest;

      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr,
        venue: notesAddr,
        adapter,
        capacity,
        duration,
        minReturn,
        deadline: now + 2n * DAY,
      }));

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1,
        asset: usdgAddr,
        venues: [notesAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY,
        maxDuration: 60n * DAY,
      }));

      await vault.connect(bob).createAccount();
      await usdgToken.connect(bob).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(bob).deposit(2, usdg(50_000));
      await mandates.connect(bob).createMandate(mandate({
        accountId: 2,
        asset: usdgAddr,
        venues: [notesAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY,
        maxDuration: 60n * DAY,
      }));

      await confluence.create(1, requested, minReturn, now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "transfer", [notesAddr, requested]) },
        { target: notesAddr, value: 0, data: notes.interface.encodeFunctionData(
            "draw", [1n, requested]) },
      ];
      const settleCalls = [
        { target: notesAddr, value: 0, data: notes.interface.encodeFunctionData(
            "markRepaid", [1n]) },
      ];
      const emergCalls = [
        { target: notesAddr, value: 0, data: notes.interface.encodeFunctionData(
            "liquidate", [1n]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(emergCalls),
        now + duration,
        usdg(100_000)
      ));

      await confluence.execute(1, execCalls);

      expect((await notes.notes(1n)).status).to.equal(NoteStatus.FUNDED);
      expect(await usdgToken.balanceOf(borrower.address)).to.equal(usdg(600_000));

      await usdgToken.connect(borrower).approve(notesAddr, requested + interest);
      await notes.connect(borrower).depositRepayment(1n);

      const noteMaturity = (await notes.notes(1n)).maturity;
      await time.increaseTo(noteMaturity);
      await confluence.settle(1, settleCalls);

      expect((await vault.account(1)).available).to.equal(usdg(51_000));
      expect((await vault.account(2)).available).to.equal(usdg(51_000));
      expect((await notes.notes(1n)).status).to.equal(NoteStatus.REPAID);
    });

    it("allows underwater liquidation of an unhealthy Note", async function () {
      const ctx = await loadFixture(deployFixture);
      const { owner, borrower, liquidator, usdgToken, wethToken, notes,
              priceFeed, router, usdgAddr, notesAddr, adapter } = ctx;

      await wethToken.connect(borrower).approve(notesAddr, weth(1));
      await notes.connect(borrower).createNote(
        usdg(1000), weth(1), usdg(100), 30n * DAY, ZERO_HASH, ZERO_HASH
      );

      await router.setCaller(owner.address, true);
      await usdgToken.mint(await router.getAddress(), usdg(1000));

      const calls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "transfer", [notesAddr, usdg(1000)]) },
        { target: notesAddr, value: 0, data: notes.interface.encodeFunctionData(
            "draw", [1n, usdg(1000)]) },
      ];

      await router.executeAggregate(
        usdgAddr, notesAddr, adapter, calls,
        await router.hashCalls(calls),
        (await time.latest()) + 3600,
        usdg(1000)
      );

      expect((await notes.notes(1n)).status).to.equal(NoteStatus.FUNDED);

      await priceFeed.setPrice(priceE8(1000));

      const routerWethBefore = await wethToken.balanceOf(await router.getAddress());
      const liqWethBefore    = await wethToken.balanceOf(liquidator.address);

      await notes.connect(liquidator).liquidateUnderwater(1n);

      const liqWethAfter    = await wethToken.balanceOf(liquidator.address);
      const routerWethAfter = await wethToken.balanceOf(await router.getAddress());

      expect(liqWethAfter - liqWethBefore).to.equal(weth(0.05));
      expect(routerWethAfter - routerWethBefore).to.equal(weth(0.95));
      expect((await notes.notes(1n)).status).to.equal(NoteStatus.LIQUIDATED);
    });
  });

  // -------------------------------------------------------------------
  describe("USDG depeg strategy", function () {
    async function setupDepeg() {
      const ctx = await loadFixture(deployFixture);
      const { alice, bob, usdgToken, vault, mandates,
              opportunities, confluence, depegAdapter,
              usdgAddr, depegAddr, watcher } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1,
        asset: usdgAddr,
        venues: [depegAddr],
        maxAllocation: usdg(50_000),
        minDuration: 1n * HOUR,
        maxDuration: 30n * DAY,
        minLiquidityBps: 8000,
        maxRiskClass: 3,
        leverageAllowed: false,
      }));

      await vault.connect(bob).createAccount();
      await usdgToken.connect(bob).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(bob).deposit(2, usdg(50_000));
      await mandates.connect(bob).createMandate(mandate({
        accountId: 2,
        asset: usdgAddr,
        venues: [depegAddr],
        maxAllocation: usdg(50_000),
        minDuration: 1n * HOUR,
        maxDuration: 30n * DAY,
        minLiquidityBps: 8000,
        maxRiskClass: 3,
        leverageAllowed: false,
      }));

      await ctx.pool.setPrice(1_003_000n);

      const now = BigInt(await time.latest());
      const principal       = usdg(100_000);
      const expectedReturn  = usdg(100_300);

      await opportunities.connect(watcher).createOpportunity(opportunity({
        asset: usdgAddr,
        venue: depegAddr,
        adapter: depegAddr,
        capacity: expectedReturn,
        duration: 3n * 86400n,
        liquidityBps: 9500,
        riskClass: 2,
        usesLeverage: false,
        minReturn: expectedReturn,
        deadline: now + 3600n,
      }));

      return { ...ctx, principal, expectedReturn, now };
    }

    it("captures profit from a USDC depeg and recovery", async function () {
      const ctx = await setupDepeg();
      const { alice, bob, usdgToken, usdcToken, vault, confluence, router,
              depegAdapter, pool, depegAddr, usdgAddr, poolAddr,
              principal, expectedReturn, now, opportunities } = ctx;

      const [priceAtDepeg] = await pool.quote();
      expect(priceAtDepeg).to.equal(1_003_000n);

      await confluence.create(
        1, principal, expectedReturn, now + 600n, now + 4n * 86400n
      );
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      const hedgeId = await depegAdapter.nextHedgeId();

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [depegAddr, principal]) },
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "open", [principal, usdc(100_000)]) },
      ];
      const settleCalls = [
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "close", [hedgeId, principal]) },
      ];
      const emergCalls = settleCalls;

      const maturity = now + 3n * 86400n;

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(emergCalls),
        maturity,
        usdg(99_000)
      ));

      const poolUsdgBefore = await usdgToken.balanceOf(poolAddr);
      const poolUsdcBefore = await usdcToken.balanceOf(poolAddr);

      await confluence.execute(1, execCalls);

      const h = await depegAdapter.hedges(1n);
      expect(h.usdcHeld).to.equal(usdc(100_300));
      expect(h.closed).to.equal(false);

      expect(await usdgToken.balanceOf(poolAddr))
        .to.equal(poolUsdgBefore + usdg(100_000));
      expect(await usdcToken.balanceOf(poolAddr))
        .to.equal(poolUsdcBefore - usdc(100_300));

      expect((await vault.account(1)).deployed).to.equal(usdg(50_000));
      expect((await vault.account(2)).deployed).to.equal(usdg(50_000));

      await pool.setPrice(1_000_000n);
      await time.increaseTo(maturity + 10n);

      await confluence.settle(1, settleCalls);

      expect((await vault.account(1)).available).to.equal(usdg(50_150));
      expect((await vault.account(1)).deployed).to.equal(0n);
      expect((await vault.account(2)).available).to.equal(usdg(50_150));
      expect((await vault.account(2)).deployed).to.equal(0n);

      expect((await depegAdapter.hedges(1n)).closed).to.equal(true);
      expect((await opportunities.getOpportunity(1)).status).to.equal(OppStatus.CLOSED);

      await vault.connect(alice).withdraw(1, usdg(50_150));
      expect(await usdgToken.balanceOf(alice.address))
        .to.equal(usdg(500_000 - 50_000 + 50_150));
    });

    it("emergencyExit unwinds the hedge even without recovery", async function () {
      const ctx = await setupDepeg();
      const { usdgToken, confluence, router, depegAdapter,
              depegAddr, usdgAddr, principal, expectedReturn, now } = ctx;

      await confluence.create(1, principal, expectedReturn, now + 600n, now + 4n * 86400n);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      const hedgeId = await depegAdapter.nextHedgeId();

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [depegAddr, principal]) },
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "open", [principal, usdc(100_000)]) },
      ];

      const emergCalls = [
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "close", [hedgeId, usdg(98_000)]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(emergCalls),
        await router.hashCalls(emergCalls),
        now + 3n * 86400n,
        usdg(98_000)
      ));
      await confluence.execute(1, execCalls);

      await ctx.pool.setPrice(1_005_000n);
      await confluence.emergencyExit(1, emergCalls);

      expect((await confluence.positions(1)).status).to.equal(Status.EMERGENCY_EXIT);
      expect((await depegAdapter.hedges(1n)).closed).to.equal(true);
    });

    it("reverts settle when the pool has not recovered enough", async function () {
      const ctx = await setupDepeg();
      const { usdgToken, confluence, router, depegAdapter,
              depegAddr, usdgAddr, principal, expectedReturn, now } = ctx;

      await confluence.create(1, principal, expectedReturn, now + 600n, now + 4n * 86400n);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      const hedgeId = await depegAdapter.nextHedgeId();
      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [depegAddr, principal]) },
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "open", [principal, usdc(100_000)]) },
      ];
      const settleCalls = [
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "close", [hedgeId, usdg(100_000)]) },
      ];

      const maturity = now + 3n * 86400n;
      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(settleCalls),
        maturity,
        usdg(99_000)
      ));
      await confluence.execute(1, execCalls);

      await ctx.pool.setPrice(1_000_100n);
      await time.increaseTo(maturity + 10n);

      await expect(confluence.settle(1, settleCalls)).to.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("Emergency exit", function () {
    it("exits via emergency path with haircut and distributes pro-rata", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, bob, usdgToken, vault, mandates, opportunities,
              confluence, router, mockVenue, adapter,
              usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      await vault.connect(bob).createAccount();
      await usdgToken.connect(bob).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(bob).deposit(2, usdg(50_000));
      await mandates.connect(bob).createMandate(mandate({
        accountId: 2, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));
      await confluence.addParticipant(1, 2, 2, usdg(50_000));

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(100_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(100_000), 30n * DAY, 100n]) },
      ];
      const emergCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "emergencyRedeem", [1n, 100n, await router.getAddress()]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(emergCalls),
        await router.hashCalls(emergCalls),
        now + 30n * DAY,
        usdg(90_000)
      ));
      await confluence.execute(1, execCalls);
      await confluence.emergencyExit(1, emergCalls);

      expect((await vault.account(1)).available).to.equal(usdg(49_500));
      expect((await vault.account(2)).available).to.equal(usdg(49_500));
      expect((await confluence.positions(1)).status).to.equal(Status.EMERGENCY_EXIT);
    });

    it("reverts when called by a non-operator", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, outsider, usdgToken, vault, mandates, opportunities,
              confluence, router, mockVenue, adapter,
              usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(50_000), duration: 30n * DAY,
        minReturn: usdg(50_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(50_000), usdg(50_000), now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));

      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(50_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(50_000), 30n * DAY, 100n]) },
      ];
      const emergCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "emergencyRedeem", [1n, 100n, await router.getAddress()]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(emergCalls),
        await router.hashCalls(emergCalls),
        now + 30n * DAY,
        usdg(45_000)
      ));
      await confluence.execute(1, execCalls);

      await expect(
        confluence.connect(outsider).emergencyExit(1, emergCalls)
      ).to.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("Cancel + Sweep", function () {
    it("cancels a FORMING position and releases all commitments", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, outsider, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));

      expect((await vault.account(1)).committed).to.equal(usdg(50_000));

      await confluence.cancel(1);
      await confluence.connect(outsider).sweepCancelled(1);

      expect((await vault.account(1)).committed).to.equal(0n);
      expect((await vault.account(1)).available).to.equal(usdg(50_000));
      expect((await mandates.getMandate(1)).reserved).to.equal(0n);
      expect((await confluence.positions(1)).status).to.equal(Status.CANCELLED);
      expect(await opportunities.opportunityPosition(1)).to.equal(0n);
    });

    it("rejects cancel by a non-creator", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, outsider, usdgToken, vault, mandates,
              opportunities, confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);

      await expect(confluence.connect(outsider).cancel(1)).to.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("Access control", function () {
    it("only aggregators can create positions", async function () {
      const ctx = await loadFixture(deployFixture);
      const { outsider, opportunities, confluence, adapter, usdgAddr, venueAddr } = ctx;

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));

      await expect(
        confluence.connect(outsider).create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY)
      ).to.be.reverted;
    });

    it("only aggregators can add participants", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, outsider, usdgToken, vault, mandates,
              opportunities, confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);

      await expect(confluence.connect(outsider).addParticipant(1, 1, 1, usdg(50_000))).to.be.reverted;
      await expect(confluence.connect(alice).addParticipant(1, 1, 1, usdg(50_000))).to.be.reverted;
    });

    it("only owner can setModule on the vault", async function () {
      const ctx = await loadFixture(deployFixture);
      const { outsider, vault } = ctx;
      await expect(vault.connect(outsider).setModule(outsider.address, true)).to.be.reverted;
    });
  });

  // -------------------------------------------------------------------
  describe("Mandate compliance (venue allowlist)", function () {
    it("rejects a participant whose mandate is too restrictive on allocation", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(30_000),
        minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);

      await expect(confluence.addParticipant(1, 1, 1, usdg(50_000))).to.be.reverted;
    });

    it("rejects a participant whose mandate has too-short maxDuration", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY, maxDuration: 15n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);

      await expect(confluence.addParticipant(1, 1, 1, usdg(50_000))).to.be.reverted;
    });

    it("rejects a venue not on the mandate allowlist", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr, notesAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));

      // Mandate allows notes, opportunity is for MockVenue
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [notesAddr],
        maxAllocation: usdg(50_000),
        minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);

      await expect(confluence.addParticipant(1, 1, 1, usdg(50_000))).to.be.reverted;
    });

    it("empty allowlist permits any venue", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));

      // No initialVenues → any venue allowed
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [],
        maxAllocation: usdg(50_000),
        minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(50_000), duration: 30n * DAY,
        minReturn: usdg(50_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(50_000), usdg(50_000), now + DAY, now + 60n * DAY);

      await expect(confluence.addParticipant(1, 1, 1, usdg(50_000))).to.not.be.reverted;
    });

    it("owner can add and remove venues dynamically", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, outsider, usdgToken, vault, mandates,
              usdgAddr, venueAddr, notesAddr, confluence, opportunities,
              adapter } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));

      // Start with an empty allowlist (any venue)
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [],
        maxAllocation: usdg(50_000),
        minDuration: DAY, maxDuration: 60n * DAY,
      }));

      expect(await mandates.venueCount(1)).to.equal(0n);

      // Add a venue — narrows to strict mode with one entry
      await mandates.connect(alice).addVenue(1, venueAddr);
      expect(await mandates.venueCount(1)).to.equal(1n);
      expect(await mandates.isVenueAllowed(1, venueAddr)).to.equal(true);
      expect(await mandates.isVenueAllowed(1, notesAddr)).to.equal(false);

      // Non-owner cannot add
      await expect(mandates.connect(outsider).addVenue(1, notesAddr)).to.be.reverted;

      // Remove the venue — reverts to any-venue mode
      await mandates.connect(alice).removeVenue(1, venueAddr);
      expect(await mandates.venueCount(1)).to.equal(0n);
      expect(await mandates.isVenueAllowed(1, notesAddr)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------
  describe("State & boundary checks", function () {
    it("cannot lock a plan without full funding", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(100_000), duration: 30n * DAY,
        minReturn: usdg(100_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(100_000), usdg(100_000), now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));

      await expect(
        confluence.lockPlan(1, plan(ZERO_HASH, ZERO_HASH, ZERO_HASH, now + 30n * DAY, usdg(40_000)))
      ).to.be.reverted;
    });

    it("cannot execute with a tampered calls array", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, vault, mandates, opportunities,
              confluence, router, mockVenue, adapter, usdgAddr, venueAddr } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [venueAddr],
        maxAllocation: usdg(50_000), minDuration: DAY, maxDuration: 60n * DAY,
      }));

      const now = BigInt(await time.latest());
      await opportunities.createOpportunity(opportunity({
        asset: usdgAddr, venue: venueAddr, adapter,
        capacity: usdg(50_000), duration: 30n * DAY,
        minReturn: usdg(50_000), deadline: now + 2n * DAY,
      }));
      await confluence.create(1, usdg(50_000), usdg(50_000), now + DAY, now + 60n * DAY);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));

      const goodCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(50_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(50_000), 30n * DAY, 100n]) },
      ];
      const settleCalls = [
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "redeem", [1n]) },
      ];

      await confluence.lockPlan(1, plan(
        await router.hashCalls(goodCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(settleCalls),
        now + 30n * DAY,
        usdg(45_000)
      ));

      const tamperedCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [venueAddr, usdg(1_000_000)]) },
        { target: venueAddr, value: 0, data: mockVenue.interface.encodeFunctionData(
            "deposit", [usdgAddr, usdg(50_000), 30n * DAY, 100n]) },
      ];

      await expect(confluence.execute(1, tamperedCalls)).to.be.reverted;
    });

    it("adapter rejects a second close on the same hedge", async function () {
      const ctx = await loadFixture(deployFixture);
      const { alice, usdgToken, usdcToken, vault, mandates, opportunities,
              confluence, router, depegAdapter, usdgAddr, depegAddr, watcher } = ctx;

      await vault.connect(alice).createAccount();
      await usdgToken.connect(alice).approve(await vault.getAddress(), usdg(50_000));
      await vault.connect(alice).deposit(1, usdg(50_000));
      await mandates.connect(alice).createMandate(mandate({
        accountId: 1, asset: usdgAddr, venues: [depegAddr],
        maxAllocation: usdg(50_000), minDuration: HOUR, maxDuration: 30n * DAY,
        minLiquidityBps: 8000, maxRiskClass: 3,
      }));

      await ctx.pool.setPrice(1_003_000n);

      const now = BigInt(await time.latest());
      await opportunities.connect(watcher).createOpportunity(opportunity({
        asset: usdgAddr, venue: depegAddr, adapter: depegAddr,
        capacity: usdg(50_150), duration: 3n * 86400n,
        liquidityBps: 9500, riskClass: 2,
        minReturn: usdg(50_150), deadline: now + 3600n,
      }));

      await confluence.create(1, usdg(50_000), usdg(50_150), now + 600n, now + 4n * 86400n);
      await confluence.addParticipant(1, 1, 1, usdg(50_000));

      const hedgeId = await depegAdapter.nextHedgeId();
      const execCalls = [
        { target: usdgAddr, value: 0, data: usdgToken.interface.encodeFunctionData(
            "approve", [depegAddr, usdg(50_000)]) },
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "open", [usdg(50_000), usdc(50_000)]) },
      ];
      const settleCalls = [
        { target: depegAddr, value: 0, data: depegAdapter.interface.encodeFunctionData(
            "close", [hedgeId, usdg(49_000)]) },
      ];

      const maturity = now + 3n * 86400n;
      await confluence.lockPlan(1, plan(
        await router.hashCalls(execCalls),
        await router.hashCalls(settleCalls),
        await router.hashCalls(settleCalls),
        maturity,
        usdg(49_000)
      ));
      await confluence.execute(1, execCalls);

      await ctx.pool.setPrice(1_000_000n);
      await time.increaseTo(maturity + 10n);
      await confluence.settle(1, settleCalls);

      await expect(
        depegAdapter.connect(ctx.owner).close(1n, usdg(0))
      ).to.be.revertedWithCustomError(depegAdapter, "AlreadyClosed");
    });
  });
});