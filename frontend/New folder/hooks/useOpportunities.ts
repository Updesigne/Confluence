'use client'
import { useQuery } from '@tanstack/react-query'
import { useWeb3 } from '@/providers/Web3Provider'

export type Opportunity = {
  id: bigint
  asset: string
  venue: string
  adapter: string
  capacity: bigint
  allocated: bigint
  duration: bigint
  liquidityBps: bigint
  riskClass: number
  usesLeverage: boolean
  minReturn: bigint
  deadline: bigint
  status: number
  metadataHash: string
  venueRefId: bigint
}

function map(raw: any): Opportunity {
  return {
    id: raw.id ?? raw[0],
    asset: raw.asset ?? raw[1],
    venue: raw.venue ?? raw[2],
    adapter: raw.adapter ?? raw[3],
    capacity: raw.capacity ?? raw[4],
    allocated: raw.allocated ?? raw[5],
    duration: raw.duration ?? raw[6],
    liquidityBps: raw.liquidityBps ?? raw[7],
    riskClass: Number(raw.riskClass ?? raw[8]),
    usesLeverage: raw.usesLeverage ?? raw[9],
    minReturn: raw.minReturn ?? raw[10],
    deadline: raw.deadline ?? raw[11],
    status: Number(raw.status ?? raw[12]),
    metadataHash: raw.metadataHash ?? raw[13],
    venueRefId: raw.venueRefId ?? raw[14],
  }
}

export function useOpportunities() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['opportunities', contracts?.addresses.opportunities],
    enabled: !!contracts,
    queryFn: async (): Promise<Opportunity[]> => {
      const next = (await contracts!.opportunities.nextOpportunityId()) as bigint
      const ids: bigint[] = []
      for (let id = 1n; id < next; id++) ids.push(id)
      const rows = await Promise.all(
        ids.map((id) => contracts!.opportunities.getOpportunity(id))
      )
      return rows.map(map)
    },
  })
}