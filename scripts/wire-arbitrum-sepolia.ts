import "dotenv/config";
import { Contract, Interface, getAddress } from "ethers";
import { address, provider, wallet } from "./lib/env";
import { log, waitTx } from "./lib/logger";
import { loadDeployment } from "./lib/state";
/** * NOTES — Arbitrum Sepolia wiring script * * This script assumes that 01-deploy-arbitrum-sepolia.ts has already * deployed every contract and written: * * deployments/arbitrum-sepolia.json * * It does NOT deploy anything. * * Responsibilities: * * 1. Authorize Confluence contracts in Router * 2. Authorize Confluence contracts in Vaults * 3. Authorize Confluence contracts in MandateRegistries * 4. Authorize Confluence contracts in OpportunityRegistry * 5. Configure Notes -> ExecutionRouter * 6. Transfer InvoiceNFT ownership -> Notes * 7. Register USDG depeg adapter + venue * 8. Register USDG approve/open/close selectors * 9. Register Notes as adapter + venue * 10. Register Notes draw/markRepaid selectors * 11. Seed deployer test balances * 12. Seed USDG pool liquidity * * The script is intentionally separate from deployment so that: * * deploy -> wire -> seed -> run E2E * * can be executed independently. */ type Deployment =
  {
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
const NOTES_ABI = ["function setRouter(address router)"];
const OWNABLE_ABI = ["function transferOwnership(address newOwner)"];
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
async function wireRouter(router: Contract, confluence: string, label: string) {
  await waitTx(label, await router.setCaller(confluence, true));
}
async function wireModule(target: Contract, module: string, label: string) {
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
  const invoiceNFT = contract(c(deployment, "invoiceNFT"), OWNABLE_ABI);
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
  /* * ============================================================ * 1. EXECUTION ROUTER * ============================================================ * * Confluence.execute() ultimately calls ExecutionRouter. * * Therefore both Confluence instances must be trusted callers. */ await wireRouter(
    router,
    confluenceUSDG,
    "router.setCaller(ConfluenceUSDG)",
  );
  await wireRouter(
    router,
    confluenceNotes,
    "router.setCaller(ConfluenceNotes)",
  );
  /* * ============================================================ * 2. USDG CONFLUENCE MODULES * ============================================================ */ await wireModule(
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
  /* * ============================================================ * 3. NOTES CONFLUENCE MODULES * ============================================================ */ await wireModule(
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
  /* * ============================================================ * 4. NOTES -> EXECUTION ROUTER * ============================================================ */ await waitTx(
    "notes.setRouter(ExecutionRouter)",
    await notes.setRouter(c(deployment, "router")),
  );
  /* * ============================================================ * 5. INVOICE NFT -> NOTES * ============================================================ * * Notes.createNoteWithInvoice() expects Notes to be the * authorized InvoiceNFT minter/owner. */ await waitTx(
    "invoiceNFT.transferOwnership(Notes)",
    await invoiceNFT.transferOwnership(notesAddress),
  );
  /* * ============================================================ * 6. USDG DEPEG ADAPTER REGISTRATION * ============================================================ * * ExecutionRouter validates: * * adapter * venue * target * selector * * The USDG strategy uses: * * venue = MockUSDGPool * adapter = USDGDepegAdapter */ await waitTx(
    "registry.setAdapter(USDGDepegAdapter,Pool)",
    await registry.setAdapter(usdgAdapter, poolAddress, true),
  );
  /* * MockUSDG.approve(adapter,...) * * This is required because the first execution call is made * through ExecutionRouter and the router validates the target * and selector. */ const usdgInterface =
    new Interface(["function approve(address spender,uint256 amount)"]);
  const usdgApproveSelector = usdgInterface.getFunction("approve")!.selector;
  await registerSelector(
    registry,
    usdgAdapter,
    poolAddress,
    usdgAddress,
    usdgApproveSelector,
    "registry.setSelector(MockUSDG.approve)",
  );
  /* * USDGDepegAdapter.open(...) */ const adapterInterface = new Interface([
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
  /* * USDGDepegAdapter.close(...) */ const adapterCloseSelector =
    new Interface([
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
  /* * ============================================================ * 7. NOTES MARKET REGISTRATION * ============================================================ * * For the Notes market: * * venue = Notes * adapter = Notes * * The market therefore uses Notes itself as both execution venue * and adapter. */ await waitTx(
    "registry.setAdapter(Notes,Notes)",
    await registry.setAdapter(notesAddress, notesAddress, true),
  );
  /* * Notes.draw(...) */ const notesDrawSelector = new Interface([
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
  /* * Notes.markRepaid(...) */ const notesMarkRepaidSelector = new Interface([
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
  /* * ============================================================ * 8. SEED TESTNET TOKENS * ============================================================ * * These calls are only appropriate for the Mock tokens. */ await waitTx(
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
  /* * ============================================================ * 9. SEED USDG/USDC POOL * ============================================================ */ await waitTx(
    "seed pool USDG",
    await usdg.mint(poolAddress, 100_000n * 1_000_000n),
  );
  await waitTx(
    "seed pool USDC",
    await usdc.mint(poolAddress, 100_000n * 1_000_000n),
  );
  /* * ============================================================ * 10. INITIAL DEPEG PRICE * ============================================================ * * 1 USDG = 1.003 USDC * * Price uses 6 decimal fixed-point representation. */ await waitTx(
    "pool.setPrice(1.003)",
    await pool.setPrice(1_003_000n),
  );
  /* * ============================================================ * COMPLETE * ============================================================ */ log.info(
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
    },
    "post-deployment wiring complete",
  );
}
main().catch((err) => {
  log.error({ err }, "post-deployment wiring failed");
  process.exit(1);
});
