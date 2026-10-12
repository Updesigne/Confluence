import dotenv from "dotenv";
import * as fs from "node:fs";
import path from "node:path";
dotenv.config({ path: process.env.ENV_FILE ?? ".env.invoice" });
import { Contract, JsonRpcProvider, Wallet } from "ethers";
const env = process.env as Record<string, string | undefined>;
for (const k of ["RPC_URL", "PRIVATE_KEY", "NOTES_ADDRESS", "INVOICE_PDF_URI"])
  if (!env[k]) throw new Error(`Missing env ${k}`);
const req = JSON.parse(fs.readFileSync("invoice-request.json", "utf8")) as {
  requestId: string;
  invoiceHash: string;
  policyHash: string;
  purposeHash: string;
  requested: string;
  interest: string;
  duration: string;
  borrower: string;
};
const provider = new JsonRpcProvider(env.RPC_URL!);
const signer = new Wallet(env.PRIVATE_KEY!, provider);
if (signer.address.toLowerCase() !== req.borrower.toLowerCase())
  throw new Error("Only the requesting borrower can create this invoice note.");
const abi = [
  "function invoiceRequests(uint256) view returns (uint256 id,address borrower,bytes32 invoiceHash,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration,uint256 createdAt,bool processed,bool approved)",
  "function offChainCollaterals(bytes32) view returns (bytes32 invoiceHash,uint256 invoiceAmount,uint256 riskScore,uint256 advanceRateBps,address debtor,bool verified,uint256 verifiedAt,bool financed)",
  "function createNoteWithInvoice(bytes32 invoiceHash,uint256 requested,uint256 interest,uint256 duration,bytes32 purposeHash,bytes32 policyHash,string pdfUri) returns (uint256)",
  "event InvoiceNoteCreated(uint256 indexed noteId,bytes32 indexed invoiceHash,uint256 invoiceTokenId,uint256 requested)",
];
const notes = new Contract(env.NOTES_ADDRESS!, abi, signer);
const request = await notes.invoiceRequests(req.requestId);
if (!request.processed)
  throw new Error(
    "CRE report has not been delivered yet. Wait for CRE, then retry.",
  );
if (!request.approved) throw new Error("CRE rejected this invoice request.");
const collateral = await notes.offChainCollaterals(req.invoiceHash);
if (!collateral.verified || collateral.financed)
  throw new Error("Invoice is not verified or has already been financed.");
const tx = await notes.createNoteWithInvoice(
  req.invoiceHash,
  BigInt(req.requested),
  BigInt(req.interest),
  BigInt(req.duration),
  req.purposeHash,
  req.policyHash,
  env.INVOICE_PDF_URI!,
);
console.log(`submitted createNoteWithInvoice ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1)
  throw new Error("Invoice note creation failed");
let noteId: string | undefined;
for (const log of receipt.logs) {
  try {
    const parsed = notes.interface.parseLog(log);
    if (parsed?.name === "InvoiceNoteCreated")
      noteId = parsed.args.noteId.toString();
  } catch {}
}
console.log(
  JSON.stringify(
    { ok: true, noteId, invoiceHash: req.invoiceHash, txHash: tx.hash },
    null,
    2,
  ),
);
