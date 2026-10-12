import { Contract, type Provider, type Signer } from 'ethers'
import {
  VAULT_ABI, MANDATE_REGISTRY_ABI, OPPORTUNITY_REGISTRY_ABI,
  CONFLUENCE_ABI, NOTES_ABI, ROUTER_ABI, ERC20_ABI,
} from './abis'
import { addressesFor, type ChainAddresses } from './addresses'

export type Contracts = {
  vault: Contract
  mandates: Contract
  opportunities: Contract
  confluence: Contract
  notes: Contract
  router: Contract
  usdc: Contract
  weth: Contract
  addresses: ChainAddresses
}

export function getContracts(chainId: number, runner: Provider | Signer): Contracts {
  const addr = addressesFor(chainId)
  if (!addr) throw new Error(`No Confluence deployment for chain ${chainId}`)
  return {
    vault: new Contract(addr.vault, VAULT_ABI, runner),
    mandates: new Contract(addr.mandates, MANDATE_REGISTRY_ABI, runner),
    opportunities: new Contract(addr.opportunities, OPPORTUNITY_REGISTRY_ABI, runner),
    confluence: new Contract(addr.confluence, CONFLUENCE_ABI, runner),
    notes: new Contract(addr.notes, NOTES_ABI, runner),
    router: new Contract(addr.router, ROUTER_ABI, runner),
    usdc: new Contract(addr.usdc, ERC20_ABI, runner),
    weth: new Contract(addr.weth, ERC20_ABI, runner),
    addresses: addr,
  }
}