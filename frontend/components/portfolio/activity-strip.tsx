'use client'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check } from 'lucide-react'
import { Hash } from '@/components/ui/primitives'
import { useTxTracker } from '@/hooks/useTxTracker'
import { shortHash } from '@/lib/web3/format'

export function ActivityStrip() {
  const router = useRouter()
  const { txs } = useTxTracker()

  return (
    <section className="activity-strip">
      <div>
        <span className="eyebrow">Latest on-chain activity</span>
        <h2>Everything is auditable.</h2>
      </div>
      <div className="activity-items">
        {txs.slice(0, 2).map((t) => (
          <div className="activity-item" key={t.timestamp}>
            <div className="activity-icon"><Check size={13} /></div>
            <div>
              <b>{t.label}</b>
              <Hash value={t.hash ? shortHash(t.hash) : 'pending'} />
            </div>
            <span>{t.status}</span>
          </div>
        ))}
        <button className="view-activity" onClick={() => router.push('/activity')}>
          View activity <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  )
}