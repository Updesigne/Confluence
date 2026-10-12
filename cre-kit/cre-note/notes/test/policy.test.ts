import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy';
const sample:any={invoiceHash:'0x'+'11'.repeat(32),evidenceHash:'0x'+'22'.repeat(32),canonical:{invoiceId:'INV-1',issuer:'0x0000000000000000000000000000000000000001',debtor:'0x0000000000000000000000000000000000000002',amount:'35000000000',dueDate:'1798761600',invoicePdfHash:'0x'+'33'.repeat(32),borrowerAddress:'0x0000000000000000000000000000000000000003',currency:'USDC'},mockChecks:{taxRegistry:{found:true,issuerMatches:true,invoiceExists:true,status:'ACTIVE'},debtorConfirmation:{confirmed:true,debtor:'0x0000000000000000000000000000000000000002'},creditBureau:{score:32,delinquent:false,disputes:0},paidOrCancelled:false}};
test('medium risk active invoice is approved at conservative 50% advance rate',()=>{const r=evaluate(sample);assert.equal(r.approved,true);assert.equal(r.advanceRateBps,5000);assert.equal(r.invoiceAmount,35000000000n)});
test('disputed invoice is rejected',()=>{const e=structuredClone(sample);e.mockChecks.creditBureau.disputes=1;assert.equal(evaluate(e).approved,false)});
test('borrower/debtor mismatch is rejected',()=>{const e=structuredClone(sample);e.mockChecks.debtorConfirmation.debtor='0x0000000000000000000000000000000000000009';assert.equal(evaluate(e).approved,false)});
test('risk above policy limit is rejected',()=>{const e=structuredClone(sample);e.mockChecks.creditBureau.score=60;assert.equal(evaluate(e).approved,false)});
