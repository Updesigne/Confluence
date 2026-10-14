import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, keccak256, AbiCoder } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.invoice') });

async function main() {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);
  const notesAddress = process.env.NOTES_ADDRESS!;

  console.log('Testing End-to-End CRE Verification Flow...');
  console.log('Signer:', signer.address);
  console.log('Notes:', notesAddress);

  const invoiceId = `INV-TEST-${Date.now().toString().slice(-4)}`;
  const pdfHash = '0x' + '22'.repeat(32);

  // 1. Submit to API
  const apiRes = await fetch('http://localhost:8787/invoice/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invoiceId,
      issuer: '0x0000000000000000000000000000000000000001',
      debtor: '0x0000000000000000000000000000000000000002',
      amount: '35000000000',
      dueDate: '2027-01-01T00:00:00Z',
      invoicePdfHash: pdfHash,
      borrowerAddress: signer.address,
      currency: 'USDC',
    }),
  });
  const apiData = await apiRes.json();
  console.log('1. Mock API invoice submitted:', apiData.invoiceHash);

  // 2. Request on-chain verification
  const notes = new Contract(notesAddress, [
    'function requestInvoiceVerification(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256) returns (uint256)',
    'event InvoiceVerificationRequested(uint256 indexed requestId,bytes32 indexed invoiceHash,address indexed borrower,bytes32 evidenceHash,bytes32 policyHash,bytes32 purposeHash,uint256 requested,uint256 interest,uint256 duration,uint256 createdAt)',
    'function invoiceRequests(uint256) view returns (uint256 id, address borrower, bytes32 invoiceHash, bytes32 evidenceHash, bytes32 policyHash, bytes32 purposeHash, uint256 requested, uint256 interest, uint256 duration, uint256 createdAt, bool processed, bool approved)',
    'function offChainCollaterals(bytes32) view returns (bytes32 invoiceHash, uint256 invoiceAmount, uint256 riskScore, uint256 advanceRateBps, address debtor, bool verified, uint256 verifiedAt, bool financed)',
  ], signer);

  const tx = await notes.requestInvoiceVerification(
    apiData.invoiceHash,
    apiData.evidenceHash,
    process.env.POLICY_HASH,
    process.env.PURPOSE_HASH,
    1000000000n, // $1,000 USDC
    10000000n,   // $10 USDC
    2592000n     // 30 days
  );
  console.log('2. Submitted request tx:', tx.hash);
  const rc = await tx.wait();
  let reqId: string | null = null;
  for (const log of rc.logs) {
    try {
      const p = notes.interface.parseLog(log);
      if (p?.name === 'InvoiceVerificationRequested') {
        reqId = p.args.requestId.toString();
        break;
      }
    } catch {}
  }
  console.log('2b. Mined on Arbitrum Sepolia! Request ID:', reqId);

  // 3. Trigger frontend /api/invoice/deliver-report (which talks to Chainlink CRE simulator)
  console.log('3. Triggering frontend /api/invoice/deliver-report to invoke Chainlink CRE...');
  const deliverRes = await fetch('http://localhost:3000/api/invoice/deliver-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: reqId, invoiceHash: apiData.invoiceHash }),
  });
  const deliverData = await deliverRes.json();
  console.log('3b. Deliver Report API Response:', deliverData);

  // 4. Verify on-chain state
  const onchainReq = await notes.invoiceRequests(reqId);
  const onchainColl = await notes.offChainCollaterals(apiData.invoiceHash);
  console.log('4. On-chain Verification Status:');
  console.log('   Processed:', onchainReq.processed);
  console.log('   Approved:', onchainReq.approved);
  console.log('   Collateral Verified:', onchainColl.verified);
  console.log('   Advance Rate (bps):', onchainColl.advanceRateBps.toString());
  console.log('   Risk Score:', onchainColl.riskScore.toString());

  if (onchainReq.processed && onchainReq.approved && onchainColl.verified) {
    console.log('SUCCESS: Chainlink CRE verified report was broadcasted on-chain and confirmed!');
  } else {
    console.error('FAILED: Not verified on-chain yet.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
