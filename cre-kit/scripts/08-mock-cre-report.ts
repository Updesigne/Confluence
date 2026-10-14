import dotenv from "dotenv";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.ENV_FILE ?? (fs.existsSync(".env.invoice") ? ".env.invoice" : path.join(__dirname, ".env.invoice"));
dotenv.config({ path: envPath });

import {
    AbiCoder,
    Contract,
    JsonRpcProvider,
    Wallet,
    concat,
} from "ethers";
import { evaluate, type Evidence } from "../cre-note/notes/src/policy.ts";

const env = process.env as Record<string, string | undefined>;
for (const k of [
    "RPC_URL",
    "PRIVATE_KEY",
    "NOTES_ADDRESS",
    "INVOICE_API_URL",
])
    if (!env[k]) throw new Error(`Missing env ${k}`);

// ------------------------------------------------------------------
// 1. Load the request state saved by 05-request-invoice-verification
// ------------------------------------------------------------------
const reqPath = process.env.INVOICE_REQUEST_FILE ?? (fs.existsSync("invoice-request.json") ? "invoice-request.json" : path.join(__dirname, "invoice-request.json"));
const req = JSON.parse(
    fs.readFileSync(reqPath, "utf8"),
) as {
    requestId: string;
    invoiceHash: string;
    evidenceHash: string;
    policyHash: string;
    purposeHash: string;
    borrower: string;
    createdAt: string;
    reportNonce: string;
};

const provider = new JsonRpcProvider(env.RPC_URL!);
const signer = new Wallet(env.PRIVATE_KEY!, provider);

const notesAbi = [
    "function protocolOwner() view returns(address)",
    "function creForwarder() view returns(address)",
    "function setCreForwarder(address forwarder)",
    "function invoiceRequests(uint256) view returns (uint256 id,address borrower,bytes32 invoiceHash,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration,uint256 createdAt,bool processed,bool approved)",
    "function onReport(bytes metadata, bytes report)",
    "event InvoiceVerified(bytes32 indexed invoiceHash,uint256 riskScore,uint256 advanceRateBps,uint256 invoiceAmount,address debtor)",
    "event InvoiceVerificationRejected(uint256 indexed requestId,bytes32 indexed invoiceHash,uint256 riskScore)",
];
const notes = new Contract(env.NOTES_ADDRESS!, notesAbi, signer);

// ------------------------------------------------------------------
// 2. Confirm we're protocolOwner and repoint forwarder to ourselves
// ------------------------------------------------------------------
const owner: string = await notes.protocolOwner();
if (owner.toLowerCase() !== signer.address.toLowerCase())
    throw new Error(
        `Signer ${signer.address} is not protocolOwner ${owner}. ` +
        `Use the deployer wallet or ask them to run this.`,
    );

const currentForwarder: string = await notes.creForwarder();
if (currentForwarder.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`Swapping creForwarder: ${currentForwarder} → ${signer.address}`);
    const tx = await notes.setCreForwarder(signer.address);
    await tx.wait();
    console.log(`  done (${tx.hash})`);
} else {
    console.log("Wallet is already the forwarder");
}

// ------------------------------------------------------------------
// 3. Read the on-chain request so we use its exact fields
// ------------------------------------------------------------------
const requestId = BigInt(req.requestId);
const request = await notes.invoiceRequests(requestId);
if (BigInt(request.id) !== requestId)
    throw new Error("Request does not exist on-chain");
if (request.processed) {
    console.log(
        `Request ${requestId} is already processed on-chain (approved=${request.approved}). Nothing to submit.`,
    );
    console.log(JSON.stringify({ ok: true, requestId: requestId.toString(), alreadyProcessed: true, approved: request.approved }, null, 2));
    process.exit(0);
}

const borrower: string = request.borrower;
const invoiceHash: string = request.invoiceHash;
const evidenceHash: string = request.evidenceHash;
const policyHash: string = request.policyHash;
const createdAt: bigint = request.createdAt;

// ------------------------------------------------------------------
// 4. Fetch the evidence from the mock invoice API
// ------------------------------------------------------------------
const apiBase = env.INVOICE_API_URL!.replace(/\/$/, "");
const evidenceRes = await fetch(
    `${apiBase}/invoice/${invoiceHash}/evidence`,
);
if (!evidenceRes.ok)
    throw new Error(
        `Evidence API ${evidenceRes.status}: ${await evidenceRes.text()}`,
    );
const evidence = (await evidenceRes.json()) as Evidence;

// ------------------------------------------------------------------
// 5. Run the same policy evaluator the workflow uses
// ------------------------------------------------------------------
const decision = evaluate(evidence);
console.log("Decision:", {
    approved: decision.approved,
    riskScore: decision.riskScore,
    advanceRateBps: decision.advanceRateBps,
    invoiceAmount: decision.invoiceAmount.toString(),
    debtor: decision.debtor,
});

// ------------------------------------------------------------------
// 6. Encode the report payload exactly as the workflow does
//    PREFIX_VERIFY = 0x00
// ------------------------------------------------------------------
const coder = AbiCoder.defaultAbiCoder();
const payloadBytes = coder.encode(
    [
        "uint256",
        "bytes32",
        "address",
        "bytes32",
        "bool",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "bytes32",
        "uint256",
        "uint256",
    ],
    [
        requestId,
        invoiceHash,
        borrower,
        policyHash,
        decision.approved,
        BigInt(decision.riskScore),
        BigInt(decision.advanceRateBps),
        decision.invoiceAmount,
        decision.debtor,
        evidenceHash,
        createdAt + 30n * 24n * 60n * 60n, // validUntil = createdAt + 30 days
        BigInt(req.reportNonce),
    ],
);
const reportPayload = concat(["0x00", payloadBytes]);

// ------------------------------------------------------------------
// 7. Call onReport ourselves
// ------------------------------------------------------------------
console.log("Calling notes.onReport(...)");
const tx = await notes.onReport("0x", reportPayload);
console.log(`  submitted: ${tx.hash}`);
const receipt = await tx.wait();
if (!receipt || receipt.status !== 1)
    throw new Error("onReport transaction failed");

// ------------------------------------------------------------------
// 8. Verify on-chain state changed
// ------------------------------------------------------------------
const after = await notes.invoiceRequests(requestId);
console.log("On-chain state after:", {
    processed: after.processed,
    approved: after.approved,
});

// ------------------------------------------------------------------
// 9. Restore the real forwarder (do this before re-enabling CRE)
// ------------------------------------------------------------------
if (
    env.RESTORE_FORWARDER !== "false" &&
    env.CRE_FORWARDER_ADDRESS &&
    env.CRE_FORWARDER_ADDRESS.toLowerCase() !== signer.address.toLowerCase()
) {
    console.log(
        `Restoring creForwarder → ${env.CRE_FORWARDER_ADDRESS}`,
    );
    const restore = await notes.setCreForwarder(env.CRE_FORWARDER_ADDRESS);
    await restore.wait();
    console.log(`  restored (${restore.hash})`);
}

console.log(JSON.stringify({ ok: true, requestId: requestId.toString() }, null, 2));