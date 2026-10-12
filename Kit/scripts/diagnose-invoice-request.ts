import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path:".env.invoice" });
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const env = process.env;
if (!env.RPC_URL || !env.PRIVATE_KEY || !env.NOTES_ADDRESS) {
  throw new Error("Missing RPC_URL, PRIVATE_KEY, or NOTES_ADDRESS");
}

const provider = new JsonRpcProvider(env.RPC_URL);
const wallet = new Wallet(env.PRIVATE_KEY, provider);

const abi = [
  "function requestIdByInvoice(bytes32) view returns (uint256)",
  "function nextInvoiceRequestId() view returns (uint256)",
  "function invoiceRequests(uint256) view returns (uint256 id,address borrower,bytes32 invoiceHash,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration,uint256 createdAt,bool processed,bool approved)",
  "function requestInvoiceVerification(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256) returns (uint256)"
];

async function main() {
  const network = await provider.getNetwork();
  const code = await provider.getCode(env.NOTES_ADDRESS!);

  console.log({
    chainId: network.chainId.toString(),
    signer: wallet.address,
    notesAddress: env.NOTES_ADDRESS,
    contractHasCode: code !== "0x",
    codeBytes: code === "0x" ? 0 : (code.length - 2) / 2
  });

  if (code === "0x") {
    throw new Error("No contract code at NOTES_ADDRESS on this RPC network");
  }

  const notes = new Contract(env.NOTES_ADDRESS!, abi, provider);

  if (!env.INVOICE_PDF_HASH || !env.POLICY_HASH || !env.PURPOSE_HASH) {
    throw new Error("Missing invoice hash, policy hash, or purpose hash");
  }

  // The API computes the canonical invoiceHash. Read it from the API record
  // or from the failed transaction's calldata; do not substitute the PDF hash.
  const apiResponse = await fetch(
    `${env.INVOICE_API_URL!.replace(/\/$/, "")}/invoice/submit`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        invoiceId: env.INVOICE_ID,
        issuer: env.ISSUER,
        debtor: env.DEBTOR,
        amount: env.AMOUNT,
        dueDate: env.DUE_DATE,
        invoicePdfHash: env.INVOICE_PDF_HASH,
        borrowerAddress: env.BORROWER_ADDRESS,
        currency: env.CURRENCY ?? "USDC"
      })
    }
  );

  if (!apiResponse.ok) {
    throw new Error(`API response ${apiResponse.status}: ${await apiResponse.text()}`);
  }

  const record = await apiResponse.json() as { invoiceHash: string; evidenceHash: string };
  const existingId = await notes.requestIdByInvoice(record.invoiceHash);
  const nextId = await notes.nextInvoiceRequestId();

  console.log({
    invoiceHash: record.invoiceHash,
    evidenceHash: record.evidenceHash,
    existingRequestId: existingId.toString(),
    nextInvoiceRequestId: nextId.toString()
  });

  if (existingId !== 0n) {
    const r = await notes.invoiceRequests(existingId);
    console.log("Existing request:", {
      id: r.id.toString(),
      borrower: r.borrower,
      policyHash: r.policyHash,
      requested: r.requested.toString(),
      interest: r.interest.toString(),
      duration: r.duration.toString(),
      createdAt: r.createdAt.toString(),
      processed: r.processed,
      approved: r.approved
    });
  }

  console.log("Next: test the exact request with staticCall; this does not submit a transaction.");
  try {
    await notes.requestInvoiceVerification.staticCall(
      record.invoiceHash,
      record.evidenceHash,
      env.POLICY_HASH,
      env.PURPOSE_HASH,
      BigInt(env.REQUESTED!),
      BigInt(env.INTEREST!),
      BigInt(env.DURATION!),
      { from: wallet.address }
    );
    console.log("Static call passed.");
  } catch (e) {
    console.error("Static call failed:", e);
  }
}

main().catch(console.error);