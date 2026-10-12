'use client'
import { useQuery } from '@tanstack/react-query'
import { useWeb3 } from '@/providers/Web3Provider'

export type Note = {
  id: bigint
  borrower: string
  requested: bigint
  funded: bigint
  collateralAmount: bigint
  interest: bigint
  duration: bigint
  maturity: bigint
  settlementCutoff: bigint
  repaidAmount: bigint
  purposeHash: string
  policyHash: string
  status: number // 0 OPEN, 1 FUNDED, 2 REPAID, 3 DEFAULTED, 4 LIQUIDATED, 5 CANCELLED
}

function map(raw: any): Note {
  return {
    id: raw.id ?? raw[0],
    borrower: raw.borrower ?? raw[1],
    requested: raw.requested ?? raw[2],
    funded: raw.funded ?? raw[3],
    collateralAmount: raw.collateralAmount ?? raw[4],
    interest: raw.interest ?? raw[5],
    duration: raw.duration ?? raw[6],
    maturity: raw.maturity ?? raw[7],
    settlementCutoff: raw.settlementCutoff ?? raw[8],
    repaidAmount: raw.repaidAmount ?? raw[9],
    purposeHash: raw.purposeHash ?? raw[10],
    policyHash: raw.policyHash ?? raw[11],
    status: Number(raw.status ?? raw[12]),
  }
}

export function useNotes() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['notes'],
    enabled: !!contracts,
    queryFn: async (): Promise<Note[]> => {
      const next = (await contracts!.notes.nextNoteId()) as bigint
      const ids: bigint[] = []
      for (let i = 1n; i < next; i++) ids.push(i)
      const rows = await Promise.all(ids.map((i) => contracts!.notes.getNote(i)))
      return rows.map(map)
    },
  })
}

export function useEthPrice() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['notes', 'ethPrice'],
    enabled: !!contracts,
    queryFn: async () => (await contracts!.notes.currentEthPriceUsd()) as bigint,
    refetchInterval: 60_000,
  })
}

export type CreateNoteInput = {
  requested: bigint
  collateralAmount: bigint
  interest: bigint
  duration: bigint
  purposeHash?: string
  policyHash?: string
}

const ZERO32 = '0x' + '00'.repeat(32)

export function useCreateNote() {
  const { contracts, signer } = useWeb3()
  return async (input: CreateNoteInput) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const notesAddr = await contracts.notes.getAddress()
    const allowance = (await contracts.weth.allowance(
      await signer.getAddress(),
      notesAddr
    )) as bigint
    if (allowance < input.collateralAmount) {
      const t = await contracts.weth.approve(notesAddr, input.collateralAmount)
      await t.wait()
    }
    const tx = await contracts.notes.createNote(
      input.requested,
      input.collateralAmount,
      input.interest,
      input.duration,
      input.purposeHash ?? ZERO32,
      input.policyHash ?? ZERO32
    )
    return tx.wait()
  }
}

export function useDepositRepayment() {
  const { contracts } = useWeb3()
  return async (noteId: bigint) => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.notes.depositRepayment(noteId)
    return tx.wait()
  }
}