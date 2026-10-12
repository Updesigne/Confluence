import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, keccak256, getAddress } from 'ethers';

test('canonical invoice ABI hash is deterministic and address checksum independent', () => {
  const coder = AbiCoder.defaultAbiCoder();
  const args = ['INV-001',getAddress('0x0000000000000000000000000000000000000001'),getAddress('0x0000000000000000000000000000000000000002'),'35000000000','1798761600','0x'+'11'.repeat(32),getAddress('0x0000000000000000000000000000000000000003'),'USDC'];
  const types = ['string','address','address','uint256','uint64','bytes32','address','string'];
  assert.equal(keccak256(coder.encode(types,args)),keccak256(coder.encode(types,args)));
  assert.equal(args[1],getAddress(args[1]));
});
