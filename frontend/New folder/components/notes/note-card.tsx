'use client'
import { ArrowUpRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Note } from '@/hooks/useNotes'
import { shortAddr, fmtUsdc, fmtWeth, tsToDate, secondsToDays } from '@/lib/web3/format'

const STATUS_LABEL = ['OPEN', 'FUNDED', 'REPAID', 'DEFAULTED', 'LIQUIDATED', 'CANCELLED'] as const

export function NoteCard({ note, ethPrice }: { note: Note; ethPrice: bigint }) {
  const router = useRouter()
  const collateralUsd = (note.collateralAmount * ethPrice) / 10n ** 20n
  const ltv = collateralUsd > 0n ? Number((note.requested * 100n) / collateralUsd) : 0
  const repaid = note.status === 2
  const label = STATUS_LABEL[note.status]

  return (
    <article className="note-card improved-note-card">
      <div className="opp-card-top">
        <div className="mandate-name">
          <span className="note-avatar">{shortAddr(note.borrower).slice(0, 2)}</span>
          <span>
            <b>Note #{note.id.toString()}</b>
            <small>{shortAddr(note.borrower)}</small>
          </span>
        </div>
        <span className={`note-status ${repaid ? 'repaid' : ''}`}>{label}</span>
      </div>

      <div className="note-headline">
        <div><span>REQUESTED</span><b>{fmtUsdc(note.requested)}</b></div>
        <div><span>INTEREST</span><b>{fmtUsdc(note.interest)}</b></div>
      </div>

      <div className="collateral-line">
        <span>◈ {fmtWeth(note.collateralAmount)}</span>
        <b>{fmtUsdc(collateralUsd)}</b>
      </div>
      <div className="ltv-label"><span>LTV <b>{ltv}%</b></span><span>Cap 80%</span></div>
      <div className="ltv-bar">
        <i style={{ width: `${ltv}%`, background: ltv > 65 ? 'var(--amber)' : 'var(--violet)' }} />
      </div>
      <div className="note-duration">
        <span>{secondsToDays(note.duration)}d</span>
        <b>{note.maturity > 0n ? tsToDate(note.maturity) : '—'}</b>
      </div>

      <div className="note-actions">
        <button
          className="card-cta"
          onClick={() => router.push(repaid ? '/activity' : '/simulator')}
        >
          {repaid ? 'View settlement' : 'Fund via Confluence'} <ArrowUpRight size={13} />
        </button>
        <button className="details-button">Details</button>
      </div>
    </article>
  )
}