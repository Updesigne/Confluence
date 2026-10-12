import "dotenv/config";
import { parseUnits } from "ethers";
import { deploy } from "./lib/artifacts";
import { address, PRICE_FEED } from "./lib/env";
import { log, waitTx } from "./lib/logger";
import { saveDeployment } from "./lib/state";

async function main() {
  log.info({ network:"arbitrum-sepolia", chainId:421614, deployer:address, notesPriceFeed:PRICE_FEED }, "starting deployment");

  const usdc = await deploy("MockUSDC","MockUSDC");
  const usdg = await deploy("MockUSDG","MockUSDG");
  const weth = await deploy("MockWETH","MockWETH");
  const invoiceNFT = await deploy("InvoiceNFT","InvoiceNFT");

  const pool = await deploy("MockUSDGPool","MockUSDGPool",[
    await usdg.getAddress(), await usdc.getAddress(), 1_003_000n, parseUnits("100000",6)
  ]);
  const registry = await deploy("AdapterRegistry","AdapterRegistry");
  const router = await deploy("ExecutionRouter","ExecutionRouter",[await registry.getAddress()]);
  const opportunities = await deploy("OpportunityRegistry","OpportunityRegistry");

  const vaultUSDG = await deploy("CapitalVaultUSDG","CapitalVault",[await usdg.getAddress()]);
  const mandatesUSDG = await deploy("MandateRegistryUSDG","MandateRegistry",[await vaultUSDG.getAddress()]);
  const vaultUSDC = await deploy("CapitalVaultUSDC","CapitalVault",[await usdc.getAddress()]);
  const mandatesUSDC = await deploy("MandateRegistryUSDC","MandateRegistry",[await vaultUSDC.getAddress()]);

  const adapter = await deploy("USDGDepegAdapter","USDGDepegAdapter",[
    await usdg.getAddress(), await usdc.getAddress(), await pool.getAddress()
  ]);
  const notes = await deploy("Notes","Notes",[
    await usdc.getAddress(), await weth.getAddress(), PRICE_FEED, await invoiceNFT.getAddress(), 5n
  ]);
  const confluenceUSDG = await deploy("ConfluenceUSDG","Confluence",[
    await vaultUSDG.getAddress(), await mandatesUSDG.getAddress(), await opportunities.getAddress(), await router.getAddress()
  ]);
  const confluenceNotes = await deploy("ConfluenceNotes","Confluence",[
    await vaultUSDC.getAddress(), await mandatesUSDC.getAddress(), await opportunities.getAddress(), await router.getAddress()
  ]);

  const d={network:"arbitrum-sepolia",chainId:421614,deployer:address,notesPriceFeed:PRICE_FEED,contracts:{
    usdc:await usdc.getAddress(),usdg:await usdg.getAddress(),weth:await weth.getAddress(),invoiceNFT:await invoiceNFT.getAddress(),
    pool:await pool.getAddress(),adapterRegistry:await registry.getAddress(),router:await router.getAddress(),opportunities:await opportunities.getAddress(),
    vaultUSDG:await vaultUSDG.getAddress(),mandatesUSDG:await mandatesUSDG.getAddress(),vaultUSDC:await vaultUSDC.getAddress(),mandatesUSDC:await mandatesUSDC.getAddress(),
    usdgAdapter:await adapter.getAddress(),notes:await notes.getAddress(),confluenceUSDG:await confluenceUSDG.getAddress(),confluenceNotes:await confluenceNotes.getAddress()
  }};
  saveDeployment(d);
  log.info({deployment:d},"deployment complete");
}
main().catch(err=>{log.error({err},"deployment failed");process.exit(1)});
