# Required test cases

## Solidity tests (run in your Foundry/Hardhat suite)
- only configured CRE forwarder can call `onReport`; protocol owner direct call reverts.
- request rejects zero hashes, zero amount/duration, interest > principal, and duplicate invoice request.
- approved report with matching request writes `offChainCollaterals`; report with mismatched borrower/invoice/policy/evidence reverts.
- expired report, zero/reused nonce, malformed payload, risk > 35, advance > 7000 bps, zero amount/debtor revert.
- rejected report marks request processed but does not verify collateral.
- borrower other than request owner cannot create the note.
- requested/interest/duration/purposeHash/policyHash mismatch prevents creation.
- duplicate invoice financing and stale verification fail.
- risk update for unknown/unverified invoice fails; liquidation below 70 fails.
- invoice liquidation return is zero until actual cash proceeds are recorded; never allocate invoice face value as cash.
- standard WETH-backed Notes flow, repayment, cancellation, Confluence execute/settle and existing USDG E2E remain regression-tested.

## API tests
- valid invoice returns stable invoiceHash/evidenceHash for repeated submission.
- invalid address/hash/date/amount rejects with 400.
- unknown invoice hash returns 404.
- mock negative conditions can be set only in development mode.

## CRE simulation
- approved evidence produces exact 12-field ABI payload with prefix 0x00.
- mismatched invoice hash, evidence hash, borrower or expired request fails closed.
- writeReport transaction status AND receiverContractExecutionStatus must both be checked.
