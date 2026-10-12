'use client'
import { useQuery } from '@tanstack/react-query'
import type { TransactionReceipt } from 'ethers'
import { useWeb3 } from '@/providers/Web3Provider'
import type { Contracts } from '@/lib/web3/contracts'

type MandateTuple = readonly [
  bigint,
  bigint,
  string,
  string,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint | number,
  boolean,
  string,
  string,
  boolean,
  bigint,
]

export type Mandate = {
  id: bigint
  accountId: bigint
  owner: string
  asset: string
  venueCount: bigint
  isVenueAllowed: (venue: string) => Promise<boolean>
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

async function mapMandate(raw: MandateTuple, contracts: Contracts): Promise<Mandate> {
  const id = raw[0]
  return {
    id,
    accountId: raw[1],
    owner: raw[2],
    asset: raw[3],
    venueCount: await contracts.mandates.venueCount(id) as bigint,
    isVenueAllowed: async (venue: string) =>
      await contracts.mandates.isVenueAllowed(id, venue) as boolean,
    maxAllocation: raw[4],
    minDuration: raw[5],
    maxDuration: raw[6],
    minLiquidityBps: raw[7],
    maxRiskClass: Number(raw[8]),
    leverageAllowed: raw[9],
    purposeHash: raw[10],
    policyHash: raw[11],
    active: raw[12],
    reserved: raw[13],
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
      return Promise.all(rows.map((row) => mapMandate(row as MandateTuple, contracts!)))
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
  initialVenues: string[]
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
  return async (input: CreateMandateInput): Promise<TransactionReceipt | null> => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.createMandate({
      accountId: input.accountId,
      asset: input.asset,
      initialVenues: [...input.initialVenues].sort((a, b) =>
        a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0
      ),
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
  return async (id: bigint, active: boolean): Promise<TransactionReceipt | null> => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.setActive(id, active)
    return tx.wait()
  }
}

export function useAddVenue() {
  const { contracts } = useWeb3()
  return async (mandateId: bigint, venue: string): Promise<TransactionReceipt | null> => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.addVenue(mandateId, venue)
    return tx.wait()
  }
}

export function useRemoveVenue() {
  const { contracts } = useWeb3()
  return async (mandateId: bigint, venue: string): Promise<TransactionReceipt | null> => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.mandates.removeVenue(mandateId, venue)
    return tx.wait()
  }
}

export function useMandateVenues(
  mandateId: bigint,
  knownVenues: readonly string[],
  enabled = true
) {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['mandates', mandateId.toString(), 'venues', knownVenues],
    enabled: !!contracts && enabled && knownVenues.length > 0,
    queryFn: async (): Promise<{ count: bigint; allowed: Record<string, boolean> }> => {
      if (!contracts) throw new Error('Not connected')
      const [count, membership] = await Promise.all([
        contracts.mandates.venueCount(mandateId) as Promise<bigint>,
        Promise.all(knownVenues.map(async (venue) => ({
          address: venue.toLowerCase(),
          allowed: await contracts.mandates.venueAllowed(mandateId, venue) as boolean,
        }))),
      ])
      return {
        count,
        allowed: Object.fromEntries(membership.map(({ address, allowed }) => [address, allowed])),
      }
    },
  })
}