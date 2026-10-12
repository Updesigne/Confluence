import { BrowserProvider } from 'ethers'

type InjectedEthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void
  isMetaMask?: boolean
  providers?: InjectedEthereumProvider[]
}

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider
  }
}

export function getMetaMaskEthereum(): InjectedEthereumProvider {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask was not detected. Install or enable the MetaMask extension.')
  }

  const providers = window.ethereum.providers ?? [window.ethereum]
  const metaMask = providers.find((injected) => injected.isMetaMask)
  if (!metaMask) {
    throw new Error('MetaMask was not detected. Install or enable the MetaMask extension.')
  }
  return metaMask
}

export async function getBrowserProvider(): Promise<BrowserProvider> {
  return new BrowserProvider(getMetaMaskEthereum())
}

export async function connectWallet() {
  const ethereum = getMetaMaskEthereum()
  const provider = new BrowserProvider(ethereum)
  const accounts = (await ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[]
  const address = accounts[0]
  if (!address) throw new Error('MetaMask did not return a connected account.')

  const signer = await provider.getSigner(address)
  const net = await provider.getNetwork()
  return { provider, signer, address, chainId: Number(net.chainId) }
}

export async function switchChain(chainId: number) {
  try {
    await getMetaMaskEthereum().request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
  } catch (e: any) {
    if (e?.code === 4902) throw new Error(`Chain ${chainId} not in wallet`)
    throw e
  }
}