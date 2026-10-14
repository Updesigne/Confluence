import dotenv from "dotenv";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.ENV_FILE ?? (fs.existsSync(".env.invoice") ? ".env.invoice" : path.join(__dirname, ".env.invoice"));
dotenv.config({ path: envPath });
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
const env = process.env as Record<string, string | undefined>;
for (const k of [
  "RPC_URL",
  "PRIVATE_KEY",
  "NOTES_ADDRESS",
  "CRE_FORWARDER_ADDRESS",
])
  if (!env[k]) throw new Error(`Missing env ${k}`);
const provider = new JsonRpcProvider(env.RPC_URL!);
const signer = new Wallet(env.PRIVATE_KEY!, provider);
const network = await provider.getNetwork();
if (network.chainId !== 421614n)
  throw new Error(
    `Refusing to configure forwarder on chain ${network.chainId}; expected Arbitrum Sepolia 421614.`,
  );
const abi = [
  "function protocolOwner() view returns(address)",
  "function creForwarder() view returns(address)",
  "function setCreForwarder(address forwarder)",
];
const notes = new Contract(env.NOTES_ADDRESS!, abi, signer);
const owner = await notes.protocolOwner();
if (owner.toLowerCase() !== signer.address.toLowerCase())
  throw new Error(
    `Signer ${signer.address} is not Notes protocolOwner ${owner}`,
  );
const target = getAddress(env.CRE_FORWARDER_ADDRESS!);
const current = await notes.creForwarder();
if (current.toLowerCase() === target.toLowerCase()) {
  console.log(`CRE forwarder already configured: ${target}`);
  process.exit(0);
}
const tx = await notes.setCreForwarder(target);
console.log(`submitted setCreForwarder ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1)
  throw new Error("setCreForwarder transaction failed");
const confirmed = await notes.creForwarder();
if (confirmed.toLowerCase() !== target.toLowerCase())
  throw new Error("Forwarder readback mismatch");
console.log(
  JSON.stringify(
    {
      ok: true,
      chainId: network.chainId.toString(),
      notes: env.NOTES_ADDRESS,
      forwarder: confirmed,
      txHash: tx.hash,
    },
    null,
    2,
  ),
);
