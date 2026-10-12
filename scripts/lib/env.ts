import "dotenv/config";
import { JsonRpcProvider, Wallet } from "ethers";


export const RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? process.env.RPC_URL;
export const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!RPC_URL) throw new Error("Missing ARBITRUM_SEPOLIA_RPC_URL/RPC_URL");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");

export const provider = new JsonRpcProvider(RPC_URL, { chainId: 421614, name: "arbitrum-sepolia" });
export const wallet = new Wallet(PRIVATE_KEY, provider);
export const address = wallet.address;
export const PRICE_FEED = process.env.NOTES_PRICE_FEED ?? "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165";
