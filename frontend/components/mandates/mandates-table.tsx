'use client'
import { CircleDashed, Search } from 'lucide-react'
import { Status } from '@/components/ui/primitives'
import { useMandateVenues, useMyMandates, type Mandate } from '@/hooks/useMandates'
import { fmtUsdc, shortAddr, secondsToDays } from '@/lib/web3/format'
import { useWeb3 } from '@/providers/Web3Provider'
import { getVenueOptions, type VenueOption } from '@/lib/web3/venues'

export function MandatesTable() {
  const { address, chainId } = useWeb3()
  const { data: mandates = [], isLoading } = useMyMandates()
  const venues = getVenueOptions(chainId ?? 0)

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
                <th>Mandate</th><th>Asset</th><th>Venue constraint</th>
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
                  <td><VenueConstraint mandate={m} venues={venues} /></td>
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

function VenueConstraint({ mandate, venues }: { mandate: Mandate; venues: VenueOption[] }) {
  const { data } = useMandateVenues(
    mandate.id,
    venues.map((venue) => venue.address),
    mandate.venueCount > 0n
  )

  if (mandate.venueCount === 0n) {
    return <span className="muted">Any venue</span>
  }

  const selected = venues.filter((venue) => data?.allowed[venue.address.toLowerCase()])
  const names = selected.map((venue) => venue.name)
  const knownAddresses = new Set(venues.map((venue) => venue.address.toLowerCase()))
  const hasUnknownVenue = Object.entries(data?.allowed ?? {}).some(
    ([address, allowed]) => allowed && !knownAddresses.has(address)
  )
  const tooltip = [
    ...names,
    ...(hasUnknownVenue ? ['Other allowlisted venue'] : []),
  ].join(', ')

  if (mandate.venueCount === 1n) {
    return <span title={tooltip || 'Venue name unavailable'}>{names[0] ?? (data || venues.length === 0 ? '1 venue' : 'Loading…')}</span>
  }

  return (
    <span className="risk" title={tooltip || 'Allowlisted venues'}>
      {mandate.venueCount.toString()} venues
    </span>
  )
}