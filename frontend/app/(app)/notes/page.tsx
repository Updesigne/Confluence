'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, FileText, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Stat } from '@/components/ui/primitives'
import { NoteCard } from '@/components/notes/note-card'
import { useNotes, useEthPrice } from '@/hooks/useNotes'
import { useWeb3 } from '@/providers/Web3Provider'

const STATUS_LABEL = ['Open', 'Open', 'Repaid', 'Defaulted', 'Liquidated', 'Cancelled']

export default function NotesPage() {
  const router = useRouter()
  const { address } = useWeb3()
  const { data: notes = [], isLoading } = useNotes()
  const { data: ethPrice = 0n } = useEthPrice()

  const [mine, setMine] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'All' | 'Open' | 'Repaid'>('All')
  const [kind, setKind] = useState<'All' | 'WETH' | 'Invoice'>('All')

  const filtered = useMemo(
    () =>
      notes.filter((n) => {
        if (mine && n.borrower.toLowerCase() !== address?.toLowerCase()) return false
        if (query && !n.id.toString().includes(query) && !n.borrower.toLowerCase().includes(query.toLowerCase())) return false
        const label = STATUS_LABEL[n.status]
        if (status === 'Open' && label !== 'Open' && label !== 'Funded') return false
        if (status === 'Repaid' && label !== 'Repaid') return false
        if (kind === 'WETH' && n.collateralKind === 2) return false
        if (kind === 'Invoice' && n.collateralKind !== 2) return false
        return true
      }),
    [notes, mine, query, status, kind, address]
  )

  const openCount = notes.filter((n) => n.status === 0 || n.status === 1).length
  const requestedUsd = notes.reduce((s, n) => s + n.requested, 0n)

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle="Policy-bound borrowing, collateralized on-chain."
        actions={
          <div className="header-actions">
            <button className="secondary-button" onClick={() => router.push('/notes/invoice')}>
              📄 Invoice Loan (CRE)
            </button>
            <button className="primary-button" onClick={() => router.push('/notes/create')}>
              <Plus size={15} /> Create note
            </button>
          </div>
        }
      />

      <div className="notes-hero">
        <div>
          <span className="eyebrow">Notes marketplace</span>
          <h2>Policy-bound loans.</h2>
          <p>Funded by vault mandates. Every borrower publishes collateral, purpose, and a hard LTV cap.</p>
        </div>
        <div className="notes-hero-actions">
          <div className="persona-toggle">
            <button className={!mine ? 'selected' : ''} onClick={() => setMine(false)}>All notes</button>
            <button className={mine ? 'selected' : ''} onClick={() => setMine(true)}>My notes</button>
          </div>
        </div>
      </div>

      <div className="note-stats">
        <Stat label="Open notes" value={String(openCount)} sub={`$${(Number(requestedUsd) / 1e6).toLocaleString()} requested`} />
        <Stat label="Total notes" value={String(notes.length)} sub="On-chain" />
        <Stat label="ETH price" value={`$${(Number(ethPrice) / 1e8).toFixed(2)}`} sub="Chainlink feed" />
        <Stat label="LTV cap" value="80%" sub="Enforced at creation" />
      </div>

      <div className="notes-filter">
        <div className="notes-search">
          <Search size={14} />
          <input placeholder="Search note or borrower" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="status-filters">
          {(['All', 'Open', 'Repaid'] as const).map((s) => (
            <button key={s} className={status === s ? 'active-filter' : ''} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <div className="status-filters" style={{ marginLeft: 6 }}>
          {(['All', 'WETH', 'Invoice'] as const).map((k) => (
            <button key={k} className={kind === k ? 'active-filter' : ''} onClick={() => setKind(k)}>
              {k === 'All' ? 'All Collateral' : k === 'WETH' ? '◈ WETH' : '📄 Invoice'}
            </button>
          ))}
        </div>
        <button className="filter-button sort-button">Newest <ChevronRight size={13} /></button>
      </div>

      {isLoading ? (
        <div className="muted">Loading notes…</div>
      ) : filtered.length ? (
        <div className="notes-grid">
          {filtered.map((n) => <NoteCard key={n.id.toString()} note={n} ethPrice={ethPrice} />)}
        </div>
      ) : (
        <div className="notes-empty">
          <FileText size={26} />
          <h3>No notes match your filters.</h3>
          <button className="secondary-button" onClick={() => { setQuery(''); setStatus('All'); setMine(false) }}>
            Reset filters
          </button>
        </div>
      )}
    </>
  )
}