import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Contract, Interface, getAddress } from "ethers";
import { deploy } from "./lib/artifacts";
import { address, PRICE_FEED, wallet, provider } from "./lib/env";
import { log, waitTx } from "./lib/logger";
import { loadDeployment, saveDeployment } from "./lib/state";

const ADAPTER_REGISTRY_ABI = [
  "function setAdapter(address adapter,address venue,bool allowed)",
  "function setSelector(address adapter,address venue,address target,bytes4 selector,bool allowed)",
];

const NOTES_ABI = [
  "function setRouter(address router)",
  "function setCreForwarder(address forwarder)",
];

const OWNABLE_ABI = [
  "function transferOwnership(address newOwner)",
];

async function main() {
  log.info({ network: "arbitrum-sepolia", chainId: 421614, deployer: address }, "Starting deployment of updated InvoiceNFT & Notes with ERC721 receiver support");

  const deployment = loadDeployment() as any;
  const usdg = deployment.contracts.usdg;
  const weth = deployment.contracts.weth;
  const router = deployment.contracts.router;
  const adapterRegistry = deployment.contracts.adapterRegistry;

  const creForwarder = process.env.CRE_FORWARDER_ADDRESS ?? "0x76c9cf548b4179F8901cda1f8623568b58215E62";

  // 1. Deploy InvoiceNFT
  log.info("Deploying updated InvoiceNFT...");
  const invoiceNFT = await deploy("InvoiceNFT", "InvoiceNFT");
  const invoiceNFTAddress = await invoiceNFT.getAddress();
  log.info({ invoiceNFTAddress }, "InvoiceNFT deployed");

  // 2. Deploy Notes
  log.info("Deploying updated Notes with IERC721Receiver support...");
  const notes = await deploy("Notes", "Notes", [
    usdg,
    weth,
    PRICE_FEED,
    invoiceNFTAddress,
    5n
  ]);
  const notesAddress = await notes.getAddress();
  log.info({ notesAddress }, "Notes deployed");

  // 3. Wire InvoiceNFT -> Notes
  log.info("Transferring InvoiceNFT ownership to Notes...");
  await waitTx("invoiceNFT.transferOwnership(Notes)", await invoiceNFT.transferOwnership(notesAddress));

  // 4. Wire Notes -> Router
  log.info("Setting router on Notes...");
  const notesContract = new Contract(notesAddress, NOTES_ABI, wallet);
  await waitTx("notes.setRouter", await notesContract.setRouter(router));

  // 5. Wire Notes CRE forwarder
  log.info(`Setting CRE forwarder on Notes: ${creForwarder}...`);
  await waitTx("notes.setCreForwarder", await notesContract.setCreForwarder(creForwarder));

  // 6. Register Notes in AdapterRegistry
  log.info("Registering Notes in AdapterRegistry...");
  const registryContract = new Contract(adapterRegistry, ADAPTER_REGISTRY_ABI, wallet);
  await waitTx("registry.setAdapter(Notes, Notes)", await registryContract.setAdapter(notesAddress, notesAddress, true));

  const notesDrawSelector = new Interface(["function draw(uint256 id,uint256 amount)"]).getFunction("draw")!.selector;
  await waitTx("registry.setSelector(draw)", await registryContract.setSelector(notesAddress, notesAddress, notesAddress, notesDrawSelector, true));

  const notesMarkRepaidSelector = new Interface(["function markRepaid(uint256 id)"]).getFunction("markRepaid")!.selector;
  await waitTx("registry.setSelector(markRepaid)", await registryContract.setSelector(notesAddress, notesAddress, notesAddress, notesMarkRepaidSelector, true));

  // 7. Update deployment state
  deployment.contracts.invoiceNFT = invoiceNFTAddress;
  deployment.contracts.notes = notesAddress;
  saveDeployment(deployment);
  log.info({ newDeployment: deployment.contracts }, "Updated deployments/arbitrum-sepolia.json");

  console.log("\nDeployment and wiring SUCCESSFUL!");
  console.log(`InvoiceNFT: ${invoiceNFTAddress}`);
  console.log(`Notes:      ${notesAddress}`);
}

main().catch((err) => {
  log.error({ err }, "Deployment and wiring failed");
  process.exit(1);
});
