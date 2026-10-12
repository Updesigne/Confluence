export type ChainAddresses = {
  vault: `0x${string}`
  mandates: `0x${string}`
  opportunities: `0x${string}`
  router: `0x${string}`
  confluence: `0x${string}`
  notes: `0x${string}`
  mockVenue: `0x${string}`
  depegAdapter: `0x${string}`
  adapterRegistry: `0x${string}`
  pool: `0x${string}`
  usdg: `0x${string}`
  usdc: `0x${string}`
  weth: `0x${string}`
  priceFeed: `0x${string}`
}

// Paste addresses from scripts/deploy.js output.
export const ADDRESSES: Record<number, ChainAddresses> = {
  421614: { // Arbitrum Sepolia
    vault: '0x7E936f72a3F685F302F51c8b97d3Bb8F20Dede1A',
    mandates: '0x9692734E45a573aAd37c89d593eA6e7F20832EE9',
    opportunities: '0x53ba7c08F2518b14e5ed2E3073B63e70B635EaEC',
    router: '0x3a0515dDFddc6838b55CE2bd8fe406E11431f58b',
    confluence: '0x976DbF8840a67ea7b6c769Bc4702d93B2F5606E8',
    notes: '0x8D723764b900A10407bE40168BA28D5C9Cfa3f04',
    mockVenue: '0x0000000000000000000000000000000000000000',
    depegAdapter: '0xB0D31fa9b32F47373014Be2A5010c312460a47d1',
    adapterRegistry: '0xc7e093e24A06135342D63D39382E0d5C55f000bF',
    pool: '0xEE6c83130fbBB88575FcF81B9b50465fdaf0b890',
    usdg: '0x915919c69634ae0A0e26c480350101b91006A77c',
    usdc: '0xF11171b3F12023e0Cbf75e18885bDeF251E87B13',
    weth: '0x6967B374D28a9225E53b074DfeDAdD32e1c5B9b8',
    priceFeed: '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165',
  },
  31337: { // Hardhat localhost
    vault: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    mandates: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    opportunities: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    router: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    confluence: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    notes: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    mockVenue: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
    depegAdapter: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
    adapterRegistry: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    pool: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
    usdg: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    usdc: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    weth: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    priceFeed: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  },
}

export function addressesFor(chainId?: number | null): ChainAddresses | null {
  if (!chainId) return null
  return ADDRESSES[chainId] ?? null
}