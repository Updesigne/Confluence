'use client'
import { CircleDashed, Search } from 'lucide-react'
import { Status } from '@/components/ui/primitives'
import { useMyMandates } from '@/hooks/useMandates'
import { fmtUsdc, shortAddr, secondsToDays } from '@/lib/web3/format'
import { useWeb3 } from '@/providers/Web3Provider'

export function MandatesTable() {
  const { address } = useWeb3()
  const { data: mandates = [], isLoading } = useMyMandates()

  if (!address) {
    return (
      <section className="section">
        <div className="notes-empty">
          <h3>Connect your wallet</h3>
          <p className="muted">Connect to view your mandates.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h1>Mandates</h1>
          <span className="muted">Rules that govern your capital</span>
        </div>
        <div className="table-tools">
          <button className="filter-button"><CircleDashed size={14} /> All statuses</button>
          <button className="filter-button"><Search size={14} /> Search</button>
        </div>
      </div>

      {isLoading ? (
        <div className="muted">Loading mandates…</div>
      ) : mandates.length === 0 ? (
        <div className="notes-empty" style={{ minHeight: 180 }}>
          <h3>No mandates yet</h3>
          <p className="muted">Author a mandate to let the protocol route your capital.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mandate</th><th>Asset</th><th>Venue</th>
                <th>Max allocation</th><th>Duration</th><th>Risk</th>
                <th>Reserved</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {mandates.map((m) => (
                <tr key={m.id.toString()}>
                  <td>
                    <div className="mandate-name">
                      <span className="mini-avatar">#{m.id.toString().padStart(3, '0')}</span>
                      <span>
                        <b>#{m.id.toString()}</b>
                        <small>Account {m.accountId.toString()}</small>
                      </span>
                    </div>
                  </td>
                  <td><span className="asset-chip">USDC</span></td>
                  <td>
                    {m.venue === '0x0000000000000000000000000000000000000000'
                      ? 'Any venue'
                      : shortAddr(m.venue)}
                  </td>
                  <td className="mono">{fmtUsdc(m.maxAllocation)}</td>
                  <td>{secondsToDays(m.minDuration)}–{secondsToDays(m.maxDuration)}d</td>
                  <td><span className="risk">≤ {m.maxRiskClass}</span></td>
                  <td className="mono">{fmtUsdc(m.reserved)}</td>
                  <td><Status>{m.active ? 'Active' : 'Paused'}</Status></td>
                  <td><button className="more">•••</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}