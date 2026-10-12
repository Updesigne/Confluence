# NOTES invoice policy + CRE integration kit

This package is an implementation baseline for the existing NOTES contracts and aggregator. It contains a hardened `Notes.sol` based on the latest Notes contract pasted in this conversation, a mock invoice evidence API, deterministic policy evaluation, CRE report payload builder, and test/deployment notes. It does **not** modify your Windows repository directly, deploy contracts, or activate a CRE workflow.

## Flow
1. Start `services/invoice-api`; submit an invoice to `POST /invoice/submit`. API returns `invoiceHash` and `evidenceHash`. Amount is the smallest unit of the declared currency (USDC is 6 decimals).
2. Borrower calls `Notes.requestInvoiceVerification(invoiceHash,evidenceHash,policyHash,purposeHash,requested,interest,duration)`. The on-chain event is the trusted request source.
3. The request script triggers the authenticated CRE HTTP workflow; CRE re-reads the request from Notes, fetches the API evidence, checks the values match, evaluates policy, then sends a signed report through the network's official Keystone/CRE forwarder.
4. If approved, borrower calls the existing `createNoteWithInvoice(...)` with terms exactly matching the request. Contract mints InvoiceNFT into Notes custody.
5. Aggregator creates an opportunity and runs the existing Confluence / ExecutionRouter funding and settlement flow.

## What is hardened in Notes.sol
- Report delivery requires the configured CRE forwarder; protocol owner is no longer an alternate report-injection path.
- Report binds request ID, invoice hash, borrower, policy hash, evidence hash, risk, advance rate, amount, debtor, expiry, and one-time nonce.
- Invoice creation requires the same borrower and exact terms as the approved request.
- Rejected reports are recorded without creating verified collateral.
- Risk updates require an existing verified invoice.
- Invoice liquidation requires risk score >= 70 and invoice-backed funded note.
- Invoice NFT face value is not treated as recovered cash in the `liquidate` return amount.

## Request and create an invoice note

Copy `scripts/.env.invoice.example` to `.env.invoice`. The two invoice scripts load that file automatically; set `ENV_FILE` only if you use a different path. The private key must be the borrower wallet; never use a mainnet key.

1. Start the API as below.
2. Configure the CRE HTTP-trigger workflow in `cre/`, including the authorized backend key, Notes address, Arbitrum Sepolia chain selector, expected policy hash, and public API URL. The workflow reads the request on-chain before trusting the trigger payload.
3. Submit the on-chain request:
   `pnpm exec tsx scripts/05-request-invoice-verification.ts`
4. After the CRE report has been delivered, create the note:
   `pnpm exec tsx scripts/06-create-approved-invoice-note.ts`
5. The resulting note ID is the input for the Notes opportunity + Confluence plan. Reuse the existing Notes aggregator flow, but make the execution call `Notes.draw(noteId, requested)` and settlement call `Notes.markRepaid(noteId)` only after repayment has been deposited and maturity requirements are met.

## Start API
```powershell
cd services/invoice-api
Copy-Item .env.example .env
pnpm install
pnpm dev
```
Example invoice submission:
```powershell
curl.exe -X POST http://localhost:8787/invoice/submit -H "Content-Type: application/json" -d "{\"invoiceId\":\"INV-001\",\"issuer\":\"0x0000000000000000000000000000000000000001\",\"debtor\":\"0x0000000000000000000000000000000000000002\",\"amount\":\"35000000000\",\"dueDate\":\"2027-01-01T00:00:00Z\",\"invoicePdfHash\":\"0x1111111111111111111111111111111111111111111111111111111111111111\",\"borrowerAddress\":\"0x0000000000000000000000000000000000000003\",\"currency\":\"USDC\"}"
```

## Critical integration notes
- `Notes.sol` is a new deployment artifact after modification. Do not overwrite source for an already deployed contract and assume the deployed bytecode changed; redeploy and rewire on a testnet.
- The API uses in-memory storage and mock checks. Restarting it loses records. Configure `INVOICE_API_SIGNER_PRIVATE_KEY` in the API `.env`; CRE verifies its signature against `evidenceSignerAddress`. Replace the map with a database and actual authoritative evidence providers before any production use.
- The CRE SDK requires the CLI-generated project config, authenticated trigger keys, chain selector/network configuration, secrets, and the network-specific forwarder. `cre/src/main.ts` includes the workflow entrypoint and write path; compile and simulate it with the installed CLI before deployment.
- Report nonce should be generated uniquely by the workflow/request service and must be nonzero. In production, use a robust nonce source or a unique request-derived nonce.
- `policyHash` must be the hash of a versioned, published policy configuration. The mock policy is demonstrative only.
- NFT custody alone is not legal assignment of the receivable. Collection rights, debtor notice, assignment enforceability, privacy, and jurisdiction-specific rules require legal design.

## Included baseline deployment scripts

`existing-testnet-scripts/` contains the supplied Arbitrum Sepolia deploy/seed/USDG E2E/Notes E2E scripts, copied as a reference. Merge these with your repository rather than replacing newer local changes. The invoice scripts are additional and require a newly deployed hardened Notes contract.

## Run tests

```powershell
cd services/invoice-api
pnpm install
pnpm test
cd ../../cre
bun install
bun test
```

## Verification
This package was generated from the latest Notes.sol source pasted in the conversation. I checked the Solidity brace balance and the duplicate-handler issue statically, but could not compile or run the Solidity/CRE tests here because the project dependencies, `solc`/Foundry toolchain, CRE CLI, RPC secrets, and testnet credentials are not available in this execution environment. Run the full compile/test/simulation sequence in your repo before deployment. No testnet deployment or CRE activation is claimed.
