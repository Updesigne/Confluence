'use client'
import { useTxLog } from '@/providers/TxTrackerProvider'
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
  return useTxLog()
}