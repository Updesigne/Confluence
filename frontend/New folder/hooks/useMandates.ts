'use client'
import { useQuery } from '@tanstack/react-query'
import { useWeb3 } from '@/providers/Web3Provider'

export type Mandate = {
  id: bigint
  accountId: bigint
  owner: string
  asset: string
  venue: string
  maxAllocation: bigint
  minDuration: bigint
  maxDuration: bigint
  minLiquidityBps: bigint
  maxRiskClass: number
  leverageAllowed: boolean
  purposeHash: string
  policyHash: string
  active: boolean
  reserved: bigint
}

function map(raw: any): Mandate {
  return {
    id: raw.id ?? raw[0],
    accountId: raw.accountId ?? raw[1],
    owner: raw.owner ?? raw[2],
    asset: raw.asset ?? raw[3],
    venue: raw.venue ?? raw[4],
    maxAllocation: raw.maxAllocation ?? raw[5],
    minDuration: raw.minDuration ?? raw[6],
    maxDuration: raw.maxDuration ?? raw[7],
    minLiquidityBps: raw.minLiquidityBps ?? raw[8],
    maxRiskClass: Number(raw.maxRiskClass ?? raw[9]),
    leverageAllowed: raw.leverageAllowed ?? raw[10],
    purposeHash: raw.purposeHash ?? raw[11],
    policyHash: raw.policyHash ?? raw[12],
    active: raw.active ?? raw[13],
    reserved: raw.reserved ?? raw[14],
  }
}

export function useMandates() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['mandates', 'all'],
    enabled: !!contracts,
    queryFn: async (): Promise<Mandate[]> => {
      const next = (await contracts!.mandates.nextMandateId()) as bigint
      const ids: bigint[] = []
      for (let i = 1n; i < next; i++) ids.push(i)
      const rows = await Promise.all(ids.map((i) => contracts!.mandates.getMandate(i)))
      return rows.map(map)
    },
  })
}

export function useMyMandates() {
  const { address } = useWeb3()
  const { data, ...rest } = useMandates()
  const mine = data?.filter((m) => m.owner.toLowerCase() === address?.toLowerCase())
  return { data: mine, ...rest }
}

export type CreateMandateInput = {
  accountId: bigint
  asset: string
  venue: string
  maxAllocation: bigint
  minDuration: bigint
  maxDuration: bigint
  minLiquidityBps: bigint
  maxRiskClass: number
  leverageAllowed: boolean
  purposeHash?: string
  policyHash?: string
}

const ZERO32 = '0x' + '00'.repeat(32)

export function useCreateMandate() {
  const { contracts } = useWeb3()
  return async (input: CreateMandateInput) => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.createMandate({
      accountId: input.accountId,
      asset: input.asset,
      venue: input.venue,
      maxAllocation: input.maxAllocation,
      minDuration: input.minDuration,
      maxDuration: input.maxDuration,
      minLiquidityBps: input.minLiquidityBps,
      maxRiskClass: input.maxRiskClass,
      leverageAllowed: input.leverageAllowed,
      purposeHash: input.purposeHash ?? ZERO32,
      policyHash: input.policyHash ?? ZERO32,
    })
    return tx.wait()
  }
}

export function useSetMandateActive() {
  const { contracts } = useWeb3()
  return async (id: bigint, active: boolean) => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.setActive(id, active)
    return tx.wait()
  }
}