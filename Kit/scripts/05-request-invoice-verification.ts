import dotenv from "dotenv";
import * as fs from "node:fs";
import path from "node:path";
dotenv.config({ path:".env.invoice" });

import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  isHexString,
  keccak256,
} from "ethers";

const required = [
  "RPC_URL",
  "PRIVATE_KEY",
  "NOTES_ADDRESS",
  "INVOICE_API_URL",
  "INVOICE_ID",
  "ISSUER",
  "DEBTOR",
  "AMOUNT",
  "DUE_DATE",
  "INVOICE_PDF_HASH",
  "BORROWER_ADDRESS",
  "POLICY_HASH",
  "PURPOSE_HASH",
  "REQUESTED",
  "INTEREST",
  "DURATION",
];
for (const k of required)
  if (!process.env[k]) throw new Error(`Missing env ${k}`);
const env = process.env as Record<string, string>;
const provider = new JsonRpcProvider(env.RPC_URL);
const signer = new Wallet(env.PRIVATE_KEY, provider);
if (signer.address.toLowerCase() !== env.BORROWER_ADDRESS.toLowerCase())
  throw new Error(
    "PRIVATE_KEY must belong to BORROWER_ADDRESS; request is borrower-bound.",
  );
if (
  !isHexString(env.INVOICE_PDF_HASH, 32) ||
  !isHexString(env.POLICY_HASH, 32) ||
  !isHexString(env.PURPOSE_HASH, 32)
)
  throw new Error(
    "PDF_HASH, POLICY_HASH and PURPOSE_HASH must be bytes32 hex strings.",
  );
const payload = {
  invoiceId: env.INVOICE_ID,
  issuer: env.ISSUER,
  debtor: env.DEBTOR,
  amount: env.AMOUNT,
  dueDate: env.DUE_DATE,
  invoicePdfHash: env.INVOICE_PDF_HASH,
  borrowerAddress: env.BORROWER_ADDRESS,
  currency: env.CURRENCY ?? "USDC",
};
const response = await fetch(
  `${env.INVOICE_API_URL.replace(/\/$/, "")}/invoice/submit`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  },
);
if (!response.ok)
  throw new Error(
    `Invoice API failed (${response.status}): ${await response.text()}`,
  );
const apiRecord = (await response.json()) as {
  invoiceHash: string;
  evidenceHash: string;
};
const abi = [
  "function requestInvoiceVerification(bytes32 invoiceHash,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration) returns (uint256)",
  "event InvoiceVerificationRequested(uint256 indexed requestId,bytes32 indexed invoiceHash,address indexed borrower,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration,uint256 createdAt)",
];
const notes = new Contract(env.NOTES_ADDRESS, abi, signer);
const tx = await notes.requestInvoiceVerification(
  apiRecord.invoiceHash,
  apiRecord.evidenceHash,
  env.POLICY_HASH,
  env.PURPOSE_HASH,
  BigInt(env.REQUESTED),
  BigInt(env.INTEREST),
  BigInt(env.DURATION),
);
console.log(`submitted request tx ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1)
  throw new Error("Request transaction failed");
const iface = notes.interface;
let requestId: string | undefined;
for (const log of receipt.logs) {
  try {
    const parsed = iface.parseLog(log);
    if (parsed?.name === "InvoiceVerificationRequested")
      requestId = parsed.args.requestId.toString();
  } catch {}
}
if (!requestId) throw new Error("InvoiceVerificationRequested event missing");
const parsedEvent = receipt.logs
  .map((log: { topics: ReadonlyArray<string>; data: string; }) => {
    try {
      return iface.parseLog(log);
    } catch {
      return null;
    }
  })
  .find((x: { name: string; }) => x?.name === "InvoiceVerificationRequested");
const createdAt = parsedEvent?.args.createdAt.toString();
if (!createdAt) throw new Error("createdAt missing from request event");
const reportNonce = BigInt(
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes32", "uint256"],
      [BigInt(requestId), apiRecord.evidenceHash, BigInt(createdAt)],
    ),
  ),
).toString();
const state = {
  chainId: (await provider.getNetwork()).chainId.toString(),
  notes: env.NOTES_ADDRESS,
  requestId,
  invoiceHash: apiRecord.invoiceHash,
  evidenceHash: apiRecord.evidenceHash,
  policyHash: env.POLICY_HASH,
  purposeHash: env.PURPOSE_HASH,
  requested: env.REQUESTED,
  interest: env.INTEREST,
  duration: env.DURATION,
  borrower: signer.address,
  createdAt,
  reportNonce,
  txHash: tx.hash,
};
const out = path.resolve(process.cwd(), "invoice-request.json");
fs.writeFileSync(out, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ ok: true, ...state, stateFile: out }, null, 2));
if (env.CRE_TRIGGER_PROXY_URL && env.CRE_WORKFLOW_ID) {
  const triggerUrl = new URL(env.CRE_TRIGGER_PROXY_URL);
  triggerUrl.searchParams.set("workflowID", env.CRE_WORKFLOW_ID);
  const triggerInput = {
    requestId,
    invoiceHash: apiRecord.invoiceHash,
    evidenceHash: apiRecord.evidenceHash,
    borrower: signer.address,
    policyHash: env.POLICY_HASH,
    reportNonce,
  };
  const triggerResponse = await fetch(triggerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: triggerInput }),
  });
  if (!triggerResponse.ok)
    throw new Error(
      `CRE trigger failed (${
        triggerResponse.status
      }): ${await triggerResponse.text()}`,
    );
  console.log("CRE trigger accepted:", await triggerResponse.text());
} else {
  console.log(
    "Set CRE_TRIGGER_PROXY_URL and CRE_WORKFLOW_ID to invoke the local authenticated CRE trigger proxy.",
  );
}
