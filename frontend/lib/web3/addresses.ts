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
  invoiceNFT?: `0x${string}`
}

// Paste addresses from scripts/deploy.js output.
export const ADDRESSES: Record<number, ChainAddresses> = {
  421614: { // Arbitrum Sepolia — USDG basis
    vault: '0xd3fab5534b12606103eda07C91B13246E87CBa29',           // vaultUSDG
    mandates: '0xa7589EBB6607fC01f3b38D2986A325586E81DB14',       // mandatesUSDG
    opportunities: '0xf86C37C6212202806AA3eFAC1c249501Ac396597',
    router: '0x5B524a9d0dA4fE08223980968015D4dFe380d0Ef',
    confluence: '0x2F629F4161E29b175b4b089c1199F0c52dE86Cc6',     // confluenceUSDG
    notes: '0x8745ceB860a7822a5d046B0D22b3A563a073C610',
    mockVenue: '0x0000000000000000000000000000000000000000',
    depegAdapter: '0x9927b8C276db3c78fe575c2E2DfF6FAbe9D3AaB8',   // usdgAdapter
    adapterRegistry: '0xeA6720aa48b2d061Dc6e7560bccFdEEBedcffBc5',
    pool: '0x4BfE159f0E1ebC610A27Ec8E5b39c891676EcBff',
    usdg: '0x3BfcBCE79FAb56B3400CB909C2B65CA00732a43B',
    usdc: '0xa5c141820297846A96552471BF91eaDd40e3Ff3c',
    weth: '0xBf18Be6e85fe617C58eFEed0f1DFb84aB999365A',
    priceFeed: '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165',
    invoiceNFT: '0xDBfa8A0f8785e77C7314B5De3E26cB888ebedE37',
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
    invoiceNFT: '0x0000000000000000000000000000000000000000',
  },
}

export function addressesFor(chainId?: number | null): ChainAddresses | null {
  if (!chainId) return null
  return ADDRESSES[chainId] ?? null
}