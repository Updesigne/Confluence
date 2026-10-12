'use client'
import { useState, useCallback } from 'react'
import type { TransactionReceipt } from 'ethers'

export type TrackedTx = {
  label: string
  hash: string
  status: 'pending' | 'confirmed' | 'failed'
  blockNumber?: number
  gasUsed?: string
  timestamp: number
  error?: string
}

export function useTxTracker() {
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

  return { txs, track }
}