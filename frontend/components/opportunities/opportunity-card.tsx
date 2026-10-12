'use client'
import { ArrowUpRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Status } from '@/components/ui/primitives'
import type { Opportunity } from '@/hooks/useOpportunities'
import { shortAddr, fmtUsdc, secondsToDays } from '@/lib/web3/format'

const STATUS_LABEL = ['OPEN', 'EXECUTED', 'CLOSED', 'CANCELLED'] as const

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const router = useRouter()
  const capacityPct = opportunity.capacity > 0n
    ? Number((opportunity.allocated * 100n) / opportunity.capacity)
    : 0

  return (
    <article className="opportunity-card">
      <div className="opp-card-top">
        <div className="opp-icon">#{opportunity.id.toString()}</div>
        <Status>{STATUS_LABEL[opportunity.status]}</Status>
      </div>
      <h3>{shortAddr(opportunity.venue)}</h3>
      <span className="muted">
        {shortAddr(opportunity.asset)} · risk {opportunity.riskClass}/10
      </span>
      <div className="opp-card-amount">
        <span>Capacity</span><b>{fmtUsdc(opportunity.capacity)}</b>
      </div>
      <div className="capacity-label">
        <span>Capacity used</span><b>{capacityPct}%</b>
      </div>
      <div className="bar"><i style={{ width: `${capacityPct}%` }} /></div>
      <div className="opportunity-meta">
        <span><small>Duration</small><b>{secondsToDays(opportunity.duration)}d</b></span>
        <span><small>Min return</small><b className="positive-text">{fmtUsdc(opportunity.minReturn)}</b></span>
        <span><small>Risk</small><b>{opportunity.riskClass} / 10</b></span>
      </div>
      <button className="card-cta" onClick={() => router.push('/simulator')}>
        Simulate confluence <ArrowUpRight size={13} />
      </button>
    </article>
  )
}