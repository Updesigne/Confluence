import { BrowserProvider, JsonRpcSigner } from 'ethers'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

export async function getBrowserProvider(): Promise<BrowserProvider> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No injected wallet. Install MetaMask or Rabby.')
  }
  return new BrowserProvider(window.ethereum)
}

export async function connectWallet() {
  const provider = await getBrowserProvider()
  const accounts = (await window.ethereum!.request({
    method: 'eth_requestAccounts',
  })) as string[]
  const signer = await provider.getSigner()
  const net = await provider.getNetwork()
  return { provider, signer, address: accounts[0], chainId: Number(net.chainId) }
}

export async function switchChain(chainId: number) {
  if (!window.ethereum) throw new Error('No wallet')
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
  } catch (e: any) {
    if (e?.code === 4902) throw new Error(`Chain ${chainId} not in wallet`)
    throw e
  }
}