'use client'
import {
  createContext, useCallback, useContext, useEffect,
  useMemo, useState, type ReactNode,
} from 'react'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { connectWallet, getBrowserProvider, switchChain } from '@/lib/web3/wallet'
import { getContracts, type Contracts } from '@/lib/web3/contracts'

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
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    setConnecting(true); setError(null)
    try {
      const c = await connectWallet()
      setAddress(c.address); setChainId(c.chainId)
      setProvider(c.provider); setSigner(c.signer)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to connect')
    } finally { setConnecting(false) }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null); setChainId(null); setProvider(null); setSigner(null)
  }, [])

  const switchTo = useCallback(async (target: number) => {
    await switchChain(target)
    const p = await getBrowserProvider()
    const net = await p.getNetwork()
    setProvider(p); setSigner(await p.getSigner()); setChainId(Number(net.chainId))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return
    ;(async () => {
      try {
        const accs = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[]
        if (!accs.length) return
        const p = await getBrowserProvider()
        const net = await p.getNetwork()
        setProvider(p); setSigner(await p.getSigner())
        setAddress(accs[0]); setChainId(Number(net.chainId))
      } catch {}
    })()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return
    const onAcc = (accs: unknown) => {
      const arr = accs as string[]
      if (!arr.length) disconnect(); else setAddress(arr[0])
    }
    const onChain = (hex: unknown) => setChainId(parseInt(hex as string, 16))
    window.ethereum.on('accountsChanged', onAcc)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum!.removeListener('accountsChanged', onAcc)
      window.ethereum!.removeListener('chainChanged', onChain)
    }
  }, [disconnect])

  const contracts = useMemo(() => {
    if (!chainId || !signer) return null
    try { return getContracts(chainId, signer) } catch { return null }
  }, [chainId, signer])

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