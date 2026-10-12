/*
 * CRE callback logic for the generated Chainlink CRE TypeScript project.
 * Wire this into the callback created by `cre init`; this file intentionally
 * contains only deterministic policy logic and ABI payload construction.
 */
import { encodeAbiParameters, parseAbiParameters, concat, toHex } from 'viem';
import { evaluate, type Evidence } from './policy.js';

export type InvoiceRequestInput = {
  requestId: bigint;
  invoiceHash: `0x${string}`;
  borrower: `0x${string}`;
  policyHash: `0x${string}`;
  evidenceHash: `0x${string}`;
  requested: bigint;
  interest: bigint;
  duration: bigint;
  createdAt: bigint;
};

export function buildNotesReport(req: InvoiceRequestInput, evidence: Evidence, reportNonce: bigint, nowSeconds: bigint, expectedPolicyHash: `0x${string}`) {
  if (req.policyHash.toLowerCase() !== expectedPolicyHash.toLowerCase()) throw new Error('unrecognized policy hash');
  if (evidence.invoiceHash.toLowerCase() !== req.invoiceHash.toLowerCase()) throw new Error('invoice hash mismatch');
  if (evidence.evidenceHash.toLowerCase() !== req.evidenceHash.toLowerCase()) throw new Error('evidence hash mismatch');
  if (evidence.canonical.borrowerAddress.toLowerCase() !== req.borrower.toLowerCase()) throw new Error('borrower mismatch');
  const policy = evaluate(evidence);
  const validUntil = req.createdAt + 30n * 24n * 60n * 60n;
  if (nowSeconds > validUntil) throw new Error('request expired');
  const payload = encodeAbiParameters(
    parseAbiParameters('uint256 requestId, bytes32 invoiceHash, address borrower, bytes32 policyHash, bool approved, uint256 riskScore, uint256 advanceRateBps, uint256 invoiceAmount, address debtor, bytes32 evidenceHash, uint256 validUntil, uint256 reportNonce'),
    [req.requestId, req.invoiceHash, req.borrower, req.policyHash, policy.approved, BigInt(policy.riskScore), BigInt(policy.advanceRateBps), policy.invoiceAmount, policy.debtor, req.evidenceHash, validUntil, reportNonce],
  );
  return concat(['0x00', payload]);
}
