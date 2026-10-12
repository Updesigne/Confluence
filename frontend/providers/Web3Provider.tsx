'use client'
import {
  createContext, useCallback, useContext, useEffect,
  useMemo, useState, type ReactNode,
} from 'react'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import {
  connectWallet, getBrowserProvider, getMetaMaskEthereum, switchChain,
} from '@/lib/web3/wallet'
import { getContracts, type Contracts } from '@/lib/web3/contracts'
import { addressesFor, type ChainAddresses } from '@/lib/web3/addresses'

type Web3State = {
  address: string | null
  chainId: number | null
  provider: BrowserProvider | null
  signer: JsonRpcSigner | null
  contracts: Contracts | null
  connecting: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchTo: (chainId: number) => Promise<void>
}

const Ctx = createContext<Web3State | null>(null)

export function Web3Provider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null)
  const [deployment, setDeployment] = useState<ChainAddresses | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    setConnecting(true); setError(null)
    try {
      const c = await connectWallet()
      setAddress(c.address); setChainId(c.chainId)
      setProvider(c.provider); setSigner(c.signer)
    } catch (e: any) {
      setError(e?.code === 4001
        ? 'Connection request was rejected in MetaMask.'
        : e?.message ?? 'Failed to connect to MetaMask.')
    } finally { setConnecting(false) }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null); setChainId(null); setProvider(null); setSigner(null)
    setError(null)
  }, [])

  const switchTo = useCallback(async (target: number) => {
    await switchChain(target)
    const p = await getBrowserProvider()
    const net = await p.getNetwork()
    setProvider(p); setSigner(await p.getSigner()); setChainId(Number(net.chainId))
  }, [])

  useEffect(() => {
    if (!chainId) {
      setDeployment(null)
      return
    }

    const configured = addressesFor(chainId)
    const hasStaticDeployment = configured &&
      Object.values(configured).every((value) => typeof value === 'string') &&
      Object.values(configured).some((value) => value !== '0x0000000000000000000000000000000000000000')
    if (configured && hasStaticDeployment) {
      setDeployment(configured)
      return
    }

    let cancelled = false
    setDeployment(null)
    fetch(`/deployments/${chainId}.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Deployment manifest not found')
        return response.json() as Promise<ChainAddresses>
      })
      .then((addresses) => {
        if (!cancelled) setDeployment(addresses)
      })
      .catch(() => {
        if (!cancelled) setDeployment(null)
      })

    return () => { cancelled = true }
  }, [chainId])

  useEffect(() => {
    let ethereum: ReturnType<typeof getMetaMaskEthereum>
    try {
      ethereum = getMetaMaskEthereum()
    } catch {
      return
    }
    ;(async () => {
      try {
        const accs = (await ethereum.request({ method: 'eth_accounts' })) as string[]
        if (!accs.length) return
        const p = await getBrowserProvider()
        const net = await p.getNetwork()
        setProvider(p); setSigner(await p.getSigner(accs[0]))
        setAddress(accs[0]); setChainId(Number(net.chainId))
      } catch {}
    })()
  }, [])

  useEffect(() => {
    let ethereum: ReturnType<typeof getMetaMaskEthereum>
    try {
      ethereum = getMetaMaskEthereum()
    } catch {
      return
    }
    const onAcc = (accs: unknown) => {
      const accounts = Array.isArray(accs) ? accs as string[] : []
      if (!accounts.length) {
        disconnect()
        return
      }
      void (async () => {
        const p = await getBrowserProvider()
        setProvider(p)
        setSigner(await p.getSigner(accounts[0]))
        setAddress(accounts[0])
      })().catch((e: Error) => setError(e.message))
    }
    const onChain = (hex: unknown) => setChainId(parseInt(hex as string, 16))
    ethereum.on('accountsChanged', onAcc)
    ethereum.on('chainChanged', onChain)
    return () => {
      ethereum.removeListener('accountsChanged', onAcc)
      ethereum.removeListener('chainChanged', onChain)
    }
  }, [disconnect])

  const contracts = useMemo(() => {
    if (!chainId || !signer || !deployment) return null
    try { return getContracts(chainId, signer, deployment) } catch { return null }
  }, [chainId, signer, deployment])

  return (
    <Ctx.Provider value={{
      address, chainId, provider, signer, contracts,
      connecting, error, connect, disconnect, switchTo,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useWeb3() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWeb3 must be inside <Web3Provider>')
  return c
}