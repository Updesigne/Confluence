import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/server.js";
const invoice = {
  invoiceId: "TEST-INV-01",
  issuer: "0x0000000000000000000000000000000000000001",
  debtor: "0x0000000000000000000000000000000000000002",
  amount: "35000000000",
  dueDate: "2027-01-01T00:00:00Z",
  invoicePdfHash: "0x" + "11".repeat(32),
  borrowerAddress: "0x0000000000000000000000000000000000000003",
  currency: "USDC",
};
test("invoice submit produces stable invoice and evidence hashes", async () => {
  const a = await request(app)
    .post("/invoice/submit")
    .send(invoice)
    .expect(201);
  const b = await request(app)
    .post("/invoice/submit")
    .send(invoice)
    .expect(200);
  assert.equal(a.body.invoiceHash, b.body.invoiceHash);
  assert.equal(a.body.evidenceHash, b.body.evidenceHash);
  assert.equal(b.body.duplicate, true);
  const evidence = await request(app)
    .get(`/invoice/${a.body.invoiceHash}/evidence`)
    .expect(200);
  assert.equal(evidence.body.canonical.invoiceId, invoice.invoiceId);
});
test("invalid invoice payload is rejected", async () => {
  await request(app)
    .post("/invoice/submit")
    .send({ ...invoice, invoicePdfHash: "nope" })
    .expect(400);
});
test("unknown invoice evidence is not found", async () => {
  await request(app)
    .get(`/invoice/0x${"aa".repeat(32)}/evidence`)
    .expect(404);
});
