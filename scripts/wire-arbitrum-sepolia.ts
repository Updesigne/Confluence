import "dotenv/config";
import { Contract, Interface, getAddress } from "ethers";
import { address, wallet } from "./lib/env";
import { log, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";



type Deployment = {
  network: string;
  chainId: number;
  deployer: string;
  notesPriceFeed?: string;
  contracts: {
    usdc: string;
    usdg: string;
    weth: string;
    invoiceNFT: string;
    pool: string;
    adapterRegistry: string;
    router: string;
    opportunities: string;
    vaultUSDG: string;
    mandatesUSDG: string;
    vaultUSDC: string;
    mandatesUSDC: string;
    usdgAdapter: string;
    notes: string;
    confluenceUSDG: string;
    confluenceNotes: string;
  };
};

const ERC20_ABI = ["function mint(address to,uint256 amount)"];
const ROUTER_ABI = ["function setCaller(address caller,bool allowed)"];
const MODULE_ABI = ["function setModule(address module,bool allowed)"];
const NOTES_ABI = [
  "function setRouter(address router)",
  "function setCreForwarder(address forwarder)",
  "function creForwarder() view returns (address)",
  "function acceptInvoiceNFTOwnership()",
];
const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
];
const ADAPTER_REGISTRY_ABI = [
  "function setAdapter(address adapter,address venue,bool allowed)",
  "function setSelector(address adapter,address venue,address target,bytes4 selector,bool allowed)",
];
const USDG_POOL_ABI = [
  "function setPrice(uint256 priceUsdcPerUsdgE6)",
  "function setDepth(uint256 depth)",
];

function c(
  deployment: Deployment,
  name: keyof Deployment["contracts"],
): string {
  const value = deployment.contracts[name];
  if (!value) {
    throw new Error(`Missing deployment address: contracts.${name}`);
  }
  return getAddress(value);
}

function contract(address_: string, abi: string[]): Contract {
  return new Contract(address_, abi, wallet);
}

async function wireRouter(
  router: Contract,
  confluence: string,
  label: string,
) {
  await waitTx(label, await router.setCaller(confluence, true));
}

async function wireModule(
  target: Contract,
  module: string,
  label: string,
) {
  await waitTx(label, await target.setModule(module, true));
}

async function registerSelector(
  registry: Contract,
  adapter: string,
  venue: string,
  target: string,
  selector: string,
  label: string,
) {
  await waitTx(
    label,
    await registry.setSelector(adapter, venue, target, selector, true),
  );
}

async function main() {
  const deployment = loadDeployment() as Deployment;

  log.info(
    {
      network: deployment.network,
      chainId: deployment.chainId,
      deployer: address,
      deploymentDeployer: deployment.deployer,
    },
    "starting post-deployment wiring",
  );

  if (deployment.chainId !== 421614) {
    throw new Error(
      `Wrong deployment chainId: expected 421614, got ${deployment.chainId}`,
    );
  }

  if (getAddress(deployment.deployer) !== getAddress(address)) {
    log.warn(
      { deploymentDeployer: deployment.deployer, currentDeployer: address },
      "deployment was created by a different address",
    );
  }

  const usdc = contract(c(deployment, "usdc"), ERC20_ABI);
  const usdg = contract(c(deployment, "usdg"), ERC20_ABI);
  const weth = contract(c(deployment, "weth"), ERC20_ABI);
  const router = contract(c(deployment, "router"), ROUTER_ABI);
  const vaultUSDG = contract(c(deployment, "vaultUSDG"), MODULE_ABI);
  const mandatesUSDG = contract(c(deployment, "mandatesUSDG"), MODULE_ABI);
  const vaultUSDC = contract(c(deployment, "vaultUSDC"), MODULE_ABI);
  const mandatesUSDC = contract(c(deployment, "mandatesUSDC"), MODULE_ABI);
  const opportunities = contract(c(deployment, "opportunities"), MODULE_ABI);
  const notes = contract(c(deployment, "notes"), NOTES_ABI);
  const registry = contract(
    c(deployment, "adapterRegistry"),
    ADAPTER_REGISTRY_ABI,
  );
  const pool = contract(c(deployment, "pool"), USDG_POOL_ABI);

  const confluenceUSDG = c(deployment, "confluenceUSDG");
  const confluenceNotes = c(deployment, "confluenceNotes");
  const usdgAdapter = c(deployment, "usdgAdapter");
  const notesAddress = c(deployment, "notes");
  const poolAddress = c(deployment, "pool");
  const usdgAddress = c(deployment, "usdg");
  const invoiceNFTAddress = c(deployment, "invoiceNFT");

  /* ============================================================
   * 1. EXECUTION ROUTER
   *
   * Confluence.execute() ultimately calls ExecutionRouter.
   * Both Confluence instances must be trusted callers.
   * ============================================================ */
  await wireRouter(router, confluenceUSDG, "router.setCaller(ConfluenceUSDG)");
  await wireRouter(router, confluenceNotes, "router.setCaller(ConfluenceNotes)");

  /* ============================================================
   * 2. USDG CONFLUENCE MODULES
   * ============================================================ */
  await wireModule(
    vaultUSDG,
    confluenceUSDG,
    "vaultUSDG.setModule(ConfluenceUSDG)",
  );
  await wireModule(
    mandatesUSDG,
    confluenceUSDG,
    "mandatesUSDG.setModule(ConfluenceUSDG)",
  );
  await wireModule(
    opportunities,
    confluenceUSDG,
    "opportunities.setModule(ConfluenceUSDG)",
  );

  /* ============================================================
   * 3. NOTES CONFLUENCE MODULES
   * ============================================================ */
  await wireModule(
    vaultUSDC,
    confluenceNotes,
    "vaultUSDC.setModule(ConfluenceNotes)",
  );
  await wireModule(
    mandatesUSDC,
    confluenceNotes,
    "mandatesUSDC.setModule(ConfluenceNotes)",
  );
  await wireModule(
    opportunities,
    confluenceNotes,
    "opportunities.setModule(ConfluenceNotes)",
  );

  /* ============================================================
   * 4. NOTES -> EXECUTION ROUTER
   * ============================================================ */
  await waitTx(
    "notes.setRouter(ExecutionRouter)",
    await notes.setRouter(c(deployment, "router")),
  );

  /* ============================================================
   * 5. NOTES -> CRE FORWARDER
   *
   * Notes.onReport() rejects any caller that isn't the configured
   * forwarder. Without this, every CRE report reverts with
   * NotForwarder() and the on-chain write never lands — the
   * workflow appears to run but nothing changes state.
   *
   * The forwarder address should match the one your CRE workflow
   * broadcasts as (see cre workflow supported-chains).
   * ============================================================ */
  const CRE_FORWARDER =
    process.env.CRE_FORWARDER_ADDRESS ??
    "0xD41263567DdfeAd91504199b8c6c87371e83ca5d";

  const currentForwarder: string = await notes.creForwarder();
  if (currentForwarder.toLowerCase() !== CRE_FORWARDER.toLowerCase()) {
    await waitTx(
      "notes.setCreForwarder(CRE forwarder)",
      await notes.setCreForwarder(CRE_FORWARDER),
    );
    const after: string = await notes.creForwarder();
    if (after.toLowerCase() !== CRE_FORWARDER.toLowerCase()) {
      throw new Error(
        `CRE forwarder readback mismatch: ${after} != ${CRE_FORWARDER}`,
      );
    }
    log.info({ CRE_FORWARDER }, "CRE forwarder set on Notes");
  } else {
    log.info({ CRE_FORWARDER }, "CRE forwarder already configured");
  }

  /* ============================================================
   * 6. INVOICE NFT -> NOTES
   *
   * Notes.createNoteWithInvoice() calls invoiceNFT.mint(...) which
   * requires Notes to own (or be authorized on) InvoiceNFT.
   *
   * If InvoiceNFT uses Ownable2Step, transferOwnership() only sets
   * Notes as pendingOwner. Notes must then accept, which requires a
   * passthrough function on Notes (acceptInvoiceNFTOwnership).
   * ============================================================ */
  const invoiceNFT = contract(invoiceNFTAddress, OWNABLE_ABI);

  const currentOwner: string = await invoiceNFT.owner();
  if (currentOwner.toLowerCase() === notesAddress.toLowerCase()) {
    log.info("InvoiceNFT already owned by Notes");
  } else {
    await waitTx(
      "invoiceNFT.transferOwnership(Notes)",
      await invoiceNFT.transferOwnership(notesAddress),
    );

    // Detect Ownable2Step: pendingOwner() will return Notes.
    let isTwoStep = false;
    try {
      const pending: string = await invoiceNFT.pendingOwner();
      isTwoStep = pending.toLowerCase() === notesAddress.toLowerCase();
    } catch {
      isTwoStep = false;
    }

    if (isTwoStep) {
      log.info(
        "InvoiceNFT is Ownable2Step — attempting Notes.acceptInvoiceNFTOwnership()",
      );
      try {
        await waitTx(
          "notes.acceptInvoiceNFTOwnership()",
          await notes.acceptInvoiceNFTOwnership(),
        );
      } catch (err) {
        log.error(
          { err },
          "acceptInvoiceNFTOwnership() failed. Add this passthrough to Notes.sol:\n" +
          "  function acceptInvoiceNFTOwnership() external onlyOwner {\n" +
          '    (bool ok,) = address(invoiceNFT).call(abi.encodeWithSignature("acceptOwnership()"));\n' +
          '    require(ok, "acceptOwnership failed");\n' +
          "  }\n" +
          "then redeploy Notes and re-run this script.",
        );
        throw err;
      }
    }

    const after: string = await invoiceNFT.owner();
    if (after.toLowerCase() !== notesAddress.toLowerCase()) {
      throw new Error(
        `InvoiceNFT ownership transfer failed: owner is still ${after}, expected ${notesAddress}`,
      );
    }
    log.info({ owner: after }, "InvoiceNFT ownership transferred to Notes");
  }

  /* ============================================================
   * 7. USDG DEPEG ADAPTER REGISTRATION
   *
   * ExecutionRouter validates adapter + venue + target + selector.
   * ============================================================ */
  await waitTx(
    "registry.setAdapter(USDGDepegAdapter,Pool)",
    await registry.setAdapter(usdgAdapter, poolAddress, true),
  );

  // MockUSDG.approve(adapter, ...) — first execution call
  const usdgInterface = new Interface([
    "function approve(address spender,uint256 amount)",
  ]);
  const usdgApproveSelector = usdgInterface.getFunction("approve")!.selector;
  await registerSelector(
    registry,
    usdgAdapter,
    poolAddress,
    usdgAddress,
    usdgApproveSelector,
    "registry.setSelector(MockUSDG.approve)",
  );

  // USDGDepegAdapter.open(...)
  const adapterInterface = new Interface([
    "function open(uint256 usdgIn,uint256 minUsdcOut)",
  ]);
  const adapterOpenSelector = adapterInterface.getFunction("open")!.selector;
  await registerSelector(
    registry,
    usdgAdapter,
    poolAddress,
    usdgAdapter,
    adapterOpenSelector,
    "registry.setSelector(USDGDepegAdapter.open)",
  );

  // USDGDepegAdapter.close(...)
  const adapterCloseSelector = new Interface([
    "function close(uint256 hedgeId,uint256 minUsdgOut)",
  ]).getFunction("close")!.selector;
  await registerSelector(
    registry,
    usdgAdapter,
    poolAddress,
    usdgAdapter,
    adapterCloseSelector,
    "registry.setSelector(USDGDepegAdapter.close)",
  );

  /* ============================================================
   * 8. NOTES MARKET REGISTRATION
   *
   * venue = Notes, adapter = Notes
   * ============================================================ */
  await waitTx(
    "registry.setAdapter(Notes,Notes)",
    await registry.setAdapter(notesAddress, notesAddress, true),
  );

  const notesDrawSelector = new Interface([
    "function draw(uint256 id,uint256 amount)",
  ]).getFunction("draw")!.selector;
  await registerSelector(
    registry,
    notesAddress,
    notesAddress,
    notesAddress,
    notesDrawSelector,
    "registry.setSelector(Notes.draw)",
  );

  const notesMarkRepaidSelector = new Interface([
    "function markRepaid(uint256 id)",
  ]).getFunction("markRepaid")!.selector;
  await registerSelector(
    registry,
    notesAddress,
    notesAddress,
    notesAddress,
    notesMarkRepaidSelector,
    "registry.setSelector(Notes.markRepaid)",
  );

  /* ============================================================
   * 9. SEED TESTNET TOKENS (Mocks only)
   * ============================================================ */
  await waitTx(
    "mint deployer USDG",
    await usdg.mint(address, 10_000n * 1_000_000n),
  );
  await waitTx(
    "mint deployer USDC",
    await usdc.mint(address, 12_000n * 1_000_000n),
  );
  await waitTx(
    "mint deployer WETH",
    await weth.mint(address, 2n * 1_000_000_000_000_000_000n),
  );

  /* ============================================================
   * 10. SEED USDG/USDC POOL
   * ============================================================ */
  await waitTx(
    "seed pool USDG",
    await usdg.mint(poolAddress, 100_000n * 1_000_000n),
  );
  await waitTx(
    "seed pool USDC",
    await usdc.mint(poolAddress, 100_000n * 1_000_000n),
  );

  /* ============================================================
   * 11. INITIAL DEPEG PRICE
   *
   * 1 USDG = 1.003 USDC, 6-decimal fixed point.
   * ============================================================ */
  await waitTx("pool.setPrice(1.003)", await pool.setPrice(1_003_000n));

  /* ============================================================
   * COMPLETE
   * ============================================================ */
  log.info(
    {
      network: deployment.network,
      chainId: deployment.chainId,
      deployer: address,
      confluenceUSDG,
      confluenceNotes,
      router: c(deployment, "router"),
      opportunities: c(deployment, "opportunities"),
      vaultUSDG: c(deployment, "vaultUSDG"),
      mandatesUSDG: c(deployment, "mandatesUSDG"),
      vaultUSDC: c(deployment, "vaultUSDC"),
      mandatesUSDC: c(deployment, "mandatesUSDC"),
      usdgAdapter,
      notes: notesAddress,
      pool: poolAddress,
      creForwarder: CRE_FORWARDER,
      invoiceNFTOwner: await invoiceNFT.owner(),
    },
    "post-deployment wiring complete",
  );
}

main().catch((err) => {
  log.error({ err }, "post-deployment wiring failed");
  process.exit(1);
});