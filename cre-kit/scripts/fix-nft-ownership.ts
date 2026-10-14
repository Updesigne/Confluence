import dotenv from "dotenv";
dotenv.config({ path: "cre-kit/scripts/.env.invoice" });
import { Contract, JsonRpcProvider, Wallet } from "ethers";

async function main() {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
  const notes = new Contract(process.env.NOTES_ADDRESS!, [
    "function invoiceNFT() view returns (address)"
  ], provider);
  const nftAddr = await notes.invoiceNFT();
  const nft = new Contract(nftAddr, [
    "function transferOwnership(address) external",
    "function owner() view returns (address)"
  ], wallet);

  console.log("InvoiceNFT address:", nftAddr);
  console.log("Current owner:", await nft.owner());
  const tx = await nft.transferOwnership(process.env.NOTES_ADDRESS!);
  console.log("tx submitted:", tx.hash);
  await tx.wait();
  console.log("New owner:", await nft.owner());
}

main().catch(console.error);
