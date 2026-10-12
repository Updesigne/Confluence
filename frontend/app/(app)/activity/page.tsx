'use client'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Hash, Stat, Status } from '@/components/ui/primitives'
import { useTxTracker } from '@/hooks/useTxTracker'
import { useWeb3 } from '@/providers/Web3Provider'
import { shortHash } from '@/lib/web3/format'

export default function ActivityPage() {
  const { txs } = useTxTracker()
  const { chainId } = useWeb3()
  const confirmed = txs.filter((t) => t.status === 'confirmed').length
  const totalGas = txs.reduce((s, t) => s + Number(t.gasUsed ?? 0), 0)

  const explorer =
    chainId === 421614 ? 'https://sepolia.arbiscan.io'
    : chainId === 31337 ? '' : 'https://arbiscan.io'

  return (
    <>
      <PageHeader title="Activity" subtitle="Every action is auditable, indexed, and one click away." />
      <section className="stats-grid">
        <Stat label="Transactions this session" value={String(txs.length)} sub={`${confirmed} confirmed`} />
        <Stat label="Failed" value={String(txs.length - confirmed)} sub="Since page load" />
        <Stat label="Success rate" value={txs.length ? `${Math.round((confirmed / txs.length) * 100)}%` : '—'} sub="This session" positive={confirmed === txs.length && txs.length > 0} />
        <Stat label="Total gas units" value={totalGas.toLocaleString()} sub="Across all txs" />
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Session log</h2>
            <span className="muted">Every state change, from mandate to settlement.</span>
          </div>
          <div className="table-tools">
            <button className="filter-button"><Search size={14} /> Search events</button>
          </div>
        </div>
        {txs.length === 0 ? (
          <div className="notes-empty">
            <h3>No activity yet</h3>
            <p className="muted">Actions you sign during this session will appear here.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method</th><th>Status</th><th>Hash</th><th>Block</th><th>Gas</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.timestamp}>
                    <td className="mono">{t.label}</td>
                    <td><Status>{t.status === 'confirmed' ? 'Confirmed' : t.status === 'failed' ? 'Failed' : 'Pending'}</Status></td>
                    <td>
                      {t.hash && explorer ? (
                        <a href={`${explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer" className="hash">
                          <span>{shortHash(t.hash)}</span>
                        </a>
                      ) : (
                        <Hash value={t.hash ? shortHash(t.hash) : '—'} />
                      )}
                    </td>
                    <td className="mono">{t.blockNumber ?? '—'}</td>
                    <td className="mono">{t.gasUsed ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}