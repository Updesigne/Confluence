import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  AbiCoder,
  Wallet,
  getAddress,
  getBytes,
  keccak256,
  toUtf8Bytes,
} from "ethers";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "256kb" }));
const PORT = Number(process.env.PORT ?? 8787);
const BPS = 10_000;
const invoices = new Map<string, any>();
const coder = AbiCoder.defaultAbiCoder();
const evidenceSigner = process.env.INVOICE_API_SIGNER_PRIVATE_KEY
  ? new Wallet(process.env.INVOICE_API_SIGNER_PRIVATE_KEY)
  : null;

const invoiceSchema = z.object({
  invoiceId: z.string().trim().min(1).max(128),
  issuer: z.string().refine((v) => {
    try {
      getAddress(v);
      return true;
    } catch {
      return false;
    }
  }),
  debtor: z.string().refine((v) => {
    try {
      getAddress(v);
      return true;
    } catch {
      return false;
    }
  }),
  amount: z.string().regex(/^[1-9][0-9]{0,77}$/), // smallest asset units, e.g. USDC has 6 decimals
  dueDate: z.string().datetime({ offset: true }),
  invoicePdfHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  borrowerAddress: z.string().refine((v) => {
    try {
      getAddress(v);
      return true;
    } catch {
      return false;
    }
  }),
  currency: z.string().trim().min(3).max(12).default("USDC"),
});

function canonicalize(v: z.infer<typeof invoiceSchema>) {
  return {
    invoiceId: v.invoiceId,
    issuer: getAddress(v.issuer),
    debtor: getAddress(v.debtor),
    amount: v.amount,
    dueDate: String(Math.floor(Date.parse(v.dueDate) / 1000)),
    invoicePdfHash: v.invoicePdfHash.toLowerCase(),
    borrowerAddress: getAddress(v.borrowerAddress),
    currency: v.currency.toUpperCase(),
  };
}
function invoiceHashOf(v: ReturnType<typeof canonicalize>) {
  return keccak256(
    coder.encode(
      [
        "string",
        "address",
        "address",
        "uint256",
        "uint64",
        "bytes32",
        "address",
        "string",
      ],
      [
        v.invoiceId,
        v.issuer,
        v.debtor,
        v.amount,
        v.dueDate,
        v.invoicePdfHash,
        v.borrowerAddress,
        v.currency,
      ],
    ),
  );
}
function evidenceHashOf(v: ReturnType<typeof canonicalize>) {
  return keccak256(toUtf8Bytes(JSON.stringify(v)));
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "notes-invoice-api" }),
);

app.post("/invoice/submit", async (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "invalid_invoice", details: parsed.error.flatten() });
  const canonical = canonicalize(parsed.data);
  const invoiceHash = invoiceHashOf(canonical);
  const evidenceHash = evidenceHashOf(canonical);
  const previous = invoices.get(invoiceHash);
  if (previous)
    return res
      .status(200)
      .json({
        invoiceHash,
        evidenceHash,
        signature: previous.signature,
        signer: previous.signer,
        canonical,
        duplicate: true,
      });
  const signature = evidenceSigner
    ? await evidenceSigner.signMessage(getBytes(evidenceHash))
    : null;
  const record = {
    invoiceHash,
    evidenceHash,
    signature,
    signer: evidenceSigner?.address ?? null,
    canonical,
    submittedAt: Date.now(),
    mockChecks: {
      taxRegistry: {
        found: true,
        issuerMatches: true,
        invoiceExists: true,
        status: "ACTIVE",
      },
      debtorConfirmation: { confirmed: true, debtor: canonical.debtor },
      creditBureau: { score: 32, delinquent: false, disputes: 0 },
      paidOrCancelled: false,
    },
  };
  invoices.set(invoiceHash, record);
  return res
    .status(201)
    .json({
      invoiceHash,
      evidenceHash,
      canonical,
      next: "Call Notes.requestInvoiceVerification(invoiceHash,evidenceHash,policyHash,purposeHash,requested,interest,duration) from borrowerAddress.",
    });
});

// CRE HTTP capability reads this endpoint. The API returns source evidence only; the workflow computes the decision.
app.get("/invoice/:invoiceHash/evidence", (req, res) => {
  const hash = req.params.invoiceHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash))
    return res.status(400).json({ error: "invalid_invoice_hash" });
  const record = invoices.get(hash);
  if (!record) return res.status(404).json({ error: "invoice_not_found" });
  return res.json(record);
});

// Explicit mock control endpoint for negative-path testing; disabled outside development.
app.post("/__test/mock-checks/:invoiceHash", (req, res) => {
  if (process.env.NODE_ENV !== "development") return res.status(404).end();
  const hash = req.params.invoiceHash.toLowerCase();
  const record = invoices.get(hash);
  if (!record) return res.status(404).json({ error: "invoice_not_found" });
  const body = z
    .object({
      taxExists: z.boolean().optional(),
      issuerMatches: z.boolean().optional(),
      debtorConfirmed: z.boolean().optional(),
      delinquent: z.boolean().optional(),
      disputes: z.number().int().min(0).optional(),
      paidOrCancelled: z.boolean().optional(),
      riskScore: z.number().int().min(0).max(100).optional(),
    })
    .parse(req.body);
  if (body.taxExists !== undefined)
    record.mockChecks.taxRegistry.invoiceExists = body.taxExists;
  if (body.issuerMatches !== undefined)
    record.mockChecks.taxRegistry.issuerMatches = body.issuerMatches;
  if (body.debtorConfirmed !== undefined)
    record.mockChecks.debtorConfirmation.confirmed = body.debtorConfirmed;
  if (body.delinquent !== undefined)
    record.mockChecks.creditBureau.delinquent = body.delinquent;
  if (body.disputes !== undefined)
    record.mockChecks.creditBureau.disputes = body.disputes;
  if (body.paidOrCancelled !== undefined)
    record.mockChecks.paidOrCancelled = body.paidOrCancelled;
  if (body.riskScore !== undefined)
    record.mockChecks.creditBureau.score = body.riskScore;
  return res.json({
    ok: true,
    invoiceHash: hash,
    mockChecks: record.mockChecks,
  });
});

if (process.env.NODE_ENV !== "test")
  app.listen(PORT, () =>
    console.log(`Notes invoice API listening on :${PORT}`),
  );

export default app;
