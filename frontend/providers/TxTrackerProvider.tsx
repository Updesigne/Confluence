'use client'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { TransactionReceipt } from 'ethers'
import type { TrackedTx } from '@/hooks/useTxTracker'

type Ctx = {
  txs: TrackedTx[]
  track: (label: string, send: () => Promise<TransactionReceipt | null>) => Promise<TransactionReceipt | null>
}

const TxCtx = createContext<Ctx | null>(null)

export function TxTrackerProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<TrackedTx[]>([])

  const track = useCallback(
    async (label: string, send: () => Promise<TransactionReceipt | null>) => {
      const pending: TrackedTx = { label, hash: '', status: 'pending', timestamp: Date.now() }
      setTxs((p) => [pending, ...p])
      try {
        const r = await send()
        if (!r) throw new Error('No receipt')
        setTxs((p) =>
          p.map((t) =>
            t.timestamp === pending.timestamp
              ? { ...t, hash: r.hash, status: 'confirmed', blockNumber: Number(r.blockNumber), gasUsed: r.gasUsed?.toString() }
              : t
          )
        )
        return r
      } catch (e: any) {
        setTxs((p) =>
          p.map((t) =>
            t.timestamp === pending.timestamp
              ? { ...t, status: 'failed', error: e?.shortMessage ?? e?.message }
              : t
          )
        )
        throw e
      }
    },
    []
  )

  return <TxCtx.Provider value={{ txs, track }}>{children}</TxCtx.Provider>
}

export function useTxLog() {
  const c = useContext(TxCtx)
  if (!c) throw new Error('useTxLog must be inside <TxTrackerProvider>')
  return c
}