export type Evidence = {
  invoiceHash: `0x${string}`;
  evidenceHash: `0x${string}`;
  signature: `0x${string}`;
  signer: `0x${string}`;
  canonical: { invoiceId: string; issuer: `0x${string}`; debtor: `0x${string}`; amount: string; dueDate: string; invoicePdfHash: `0x${string}`; borrowerAddress: `0x${string}`; currency: string };
  mockChecks: { taxRegistry: { found: boolean; issuerMatches: boolean; invoiceExists: boolean; status: string }; debtorConfirmation: { confirmed: boolean; debtor: string }; creditBureau: { score: number; delinquent: boolean; disputes: number }; paidOrCancelled: boolean };
};
export function evaluate(e: Evidence) {
  const checks = e.mockChecks;
  const riskScore = Math.max(0, Math.min(100, checks.creditBureau.score));
  const approved = checks.taxRegistry.found && checks.taxRegistry.issuerMatches && checks.taxRegistry.invoiceExists && checks.taxRegistry.status === 'ACTIVE' && checks.debtorConfirmation.confirmed && checks.debtorConfirmation.debtor.toLowerCase() === e.canonical.debtor.toLowerCase() && !checks.creditBureau.delinquent && checks.creditBureau.disputes === 0 && !checks.paidOrCancelled && riskScore <= 35 && e.canonical.currency === 'USDC';
  // Conservative fixed tiers; not a real credit score or a promise of repayment.
  const advanceRateBps = !approved ? 0 : riskScore <= 15 ? 7000 : riskScore <= 35 ? 5000 : 0;
  return { approved, riskScore, advanceRateBps, invoiceAmount: BigInt(e.canonical.amount), debtor: e.canonical.debtor, evidenceHash: e.evidenceHash };
}
