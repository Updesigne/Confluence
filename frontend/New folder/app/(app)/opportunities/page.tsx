'use client'
import { SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { OpportunityCard } from '@/components/opportunities/opportunity-card'
import { useOpportunities } from '@/hooks/useOpportunities'

export default function OpportunitiesPage() {
  const { data: opportunities = [], isLoading } = useOpportunities()

  return (
    <>
      <PageHeader title="Opportunities" subtitle="Discover yield that matches your mandates." />
      <div className="filter-bar">
        <button className="filter-button active-filter">All opportunities</button>
        <button className="filter-button">DeFi</button>
        <button className="filter-button">Notes</button>
        <div className="filter-spacer" />
        <button className="filter-button"><SlidersHorizontal size={14} /> Filters</button>
      </div>
      {isLoading ? (
        <div className="muted">Loading opportunities…</div>
      ) : opportunities.length === 0 ? (
        <div className="notes-empty">
          <h3>No opportunities yet</h3>
          <p className="muted">The aggregator has not published any.</p>
        </div>
      ) : (
        <div className="opportunity-grid">
          {opportunities.map((o) => (
            <OpportunityCard key={o.id.toString()} opportunity={o} />
          ))}
        </div>
      )}
    </>
  )
}