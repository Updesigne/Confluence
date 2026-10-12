'use client'
import { useEffect, useState } from 'react'
import { Check, CircleDashed, ExternalLink, X } from 'lucide-react'
import { Hash } from '@/components/ui/primitives'
import { useShell } from '@/components/ui/shell/shell-context'
import { useWeb3 } from '@/providers/Web3Provider'
import { useVaultAccounts } from '@/hooks/useVault'
import { useCreateMandate } from '@/hooks/useMandates'
import { parseUsdc, shortAddr } from '@/lib/web3/format'
import type { VenueOption } from '@/lib/web3/venues'
import type { TransactionReceipt } from 'ethers'

export function MandateModal({
  close,
  track,
  venues,
}: {
  close: () => void
  venues: VenueOption[]
  track?: (label: string, send: () => Promise<TransactionReceipt | null>) => Promise<TransactionReceipt | null>
}) {
  const { notify } = useShell()
  const { contracts, address } = useWeb3()
  const { data: accounts = [] } = useVaultAccounts()
  const createMandate = useCreateMandate()

  const [capital, setCapital] = useState('50000')
  const [venueMode, setVenueMode] = useState<'any' | 'selected'>('any')
  const [selectedVenues, setSelectedVenues] = useState<string[]>([])
  const [min, setMin] = useState(30)
  const [max, setMax] = useState(180)
  const [risk, setRisk] = useState(5)
  const [liquidity, setLiquidity] = useState(0)
  const [leverage, setLeverage] = useState(false)
  const [accountId, setAccountId] = useState<string>('')

  const [phase, setPhase] = useState<'idle' | 'busy' | 'success'>('idle')
  const [txHash, setTxHash] = useState('')

  useEffect(() => {
    if (accounts.length && !accountId) setAccountId(accounts[0].id.toString())
  }, [accounts, accountId])

  const amount = Number(capital.replace(/,/g, '')) || 0
  const display = amount ? amount.toLocaleString('en-US', { maximumFractionDigits: 6 }) : ''
  const valid = amount > 0 && !!accountId &&
    !(venueMode === 'selected' && selectedVenues.length === 0)

  const venueSummary = venueMode === 'any'
    ? 'any approved venue'
    : `${selectedVenues.length} selected venue${selectedVenues.length === 1 ? '' : 's'}`
  const sentence = `Commit up to $${display || '0'} USDG to ${venueSummary}, maturities ${min}–${max} days, max risk class ${risk}, liquidity floor ${liquidity}%, ${leverage ? 'with' : 'without'} leverage.`

  const toggleVenue = (address: string) => {
    setSelectedVenues((current) => current.some((selected) => selected.toLowerCase() === address.toLowerCase())
      ? current.filter((selected) => selected.toLowerCase() !== address.toLowerCase())
      : [...current, address])
  }

  const submit = async () => {
    if (!valid || !contracts || !address || (venueMode === 'selected' && selectedVenues.length === 0)) return
    setPhase('busy')
    try {
      const send = () =>
        createMandate({
          accountId: BigInt(accountId),
          asset: contracts.addresses.usdg,
          initialVenues: venueMode === 'any'
            ? []
            : [...selectedVenues].sort((a, b) =>
              a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0
            ),
          maxAllocation: parseUsdc(capital),
          minDuration: BigInt(min * 86400),
          maxDuration: BigInt(max * 86400),
          minLiquidityBps: BigInt(liquidity * 100),
          maxRiskClass: risk,
          leverageAllowed: leverage,
        })

      const receipt = track
        ? await track('createMandate', send)
        : await send()

      setTxHash(receipt?.hash ?? '')
      setPhase('success')
      notify('Mandate created')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Transaction failed'
      const shortMessage = typeof error === 'object' && error !== null && 'shortMessage' in error
        ? error.shortMessage
        : undefined
      notify(typeof shortMessage === 'string' ? shortMessage : message)
      setPhase('idle')
    }
  }

  if (phase === 'success') {
    return (
      <div className="modal-backdrop">
        <div className="modal mandate-modal success-modal">
          <div className="success-panel">
            <div className="success-check"><Check size={28} /></div>
            <span className="eyebrow">On-chain confirmation</span>
            <h2>Mandate created.</h2>
            <p className="muted">{sentence}</p>
            {txHash && <div className="success-hash"><Hash value={`${txHash.slice(0, 10)}…${txHash.slice(-4)}`} /></div>}
            <div className="success-actions">
              <button className="primary-button" onClick={close}>Continue</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className={`modal mandate-modal ${phase === 'busy' ? 'modal-busy' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <div>
            <span className="eyebrow">Policy authoring</span>
            <h2>Create mandate</h2>
            <p className="modal-subtitle">Define the rules your capital will follow. The protocol enforces them on-chain.</p>
          </div>
          <button className="modal-close" onClick={close} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="mandate-scroll">
          {accounts.length === 0 ? (
            <div className="notes-empty" style={{ marginTop: 24 }}>
              <h3>No vault accounts yet</h3>
              <p className="muted">Create a vault account on the Portfolio page first.</p>
            </div>
          ) : (
            <>
              <section className="mandate-field">
                <label>Vault account</label>
                <select
                  className="input-field"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {accounts.map((a) => (
                    <option key={a.id.toString()} value={a.id.toString()}>
                      Vault #{a.id.toString()} — ${(Number(a.available) / 1e6).toFixed(2)} available
                    </option>
                  ))}
                </select>
              </section>

              <section className="mandate-field">
                <label>Capital to commit</label>
                <div className="capital-input">
                  <span>◈</span>
                  <input
                    value={display}
                    onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                  <span>USDG</span>
                </div>
                <div className="quick-chips">
                  {['1000', '10000', '50000', '100000'].map((v) => (
                    <button key={v} onClick={() => setCapital(v)}>{Number(v).toLocaleString()}</button>
                  ))}
                </div>
              </section>

              <section className="mandate-field">
                <label>Venue access</label>
                <button
                  className={`venue-card ${venueMode === 'any' ? 'selected' : ''}`}
                  onClick={() => setVenueMode('any')}
                  type="button"
                  aria-pressed={venueMode === 'any'}
                >
                  <span className="radio-dot" />
                  <span>
                    <b>Any venue (recommended)</b>
                    <small className="field-helper">Trust any adapter approved by the protocol.</small>
                  </span>
                </button>
                <button
                  className={`venue-card ${venueMode === 'selected' ? 'selected' : ''}`}
                  onClick={() => setVenueMode('selected')}
                  type="button"
                  disabled={venues.length === 0}
                  aria-pressed={venueMode === 'selected'}
                >
                  <span className="radio-dot" />
                  <span>
                    <b>Selected venues only</b>
                    <small className="field-helper">Only route capital through the venues below.</small>
                  </span>
                </button>
                {venueMode === 'selected' && (
                  <div className="venue-selection">
                    <label>Select venues ({selectedVenues.length} selected)</label>
                    {venues.length === 0 ? (
                      <p className="field-helper">No venues are configured for this network. Update the venue addresses before using an allowlist.</p>
                    ) : (
                      <div className="quick-chips">
                        {venues.map((venue) => {
                          const checked = selectedVenues.some((selected) =>
                            selected.toLowerCase() === venue.address.toLowerCase()
                          )
                          return (
                            <button
                              key={venue.address}
                              className={checked ? 'active-chip' : ''}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => toggleVenue(venue.address)}
                              title={venue.description}
                            >
                              <span>{checked ? '☑' : '☐'} {venue.name}</span>
                              <small>{shortAddr(venue.address)} · {venue.symbol}</small>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {selectedVenues.length === 0 && (
                      <p className="field-helper" role="alert">⚠ At least one venue must be selected.</p>
                    )}
                  </div>
                )}
              </section>

              <section className="mandate-field">
                <label>Duration window</label>
                <div className="range-readout">
                  <span>Min: <b>{min} days</b></span>
                  <span>Max: <b>{max} days</b></span>
                </div>
                <label className="field-helper" htmlFor="mandate-min-duration">Minimum duration</label>
                <input
                  id="mandate-min-duration"
                  className="range"
                  type="range"
                  min="0"
                  max={max - 1}
                  step="1"
                  value={min}
                  onChange={(e) => setMin(Math.min(+e.target.value, max - 1))}
                />
                <small className="field-helper">Choose 0 days for a short testnet demo; the opportunity still enforces its own maturity.</small>
                <label className="field-helper" htmlFor="mandate-max-duration">Maximum duration</label>
                <input
                  id="mandate-max-duration"
                  className="range" type="range" min={Math.max(1, min + 1)} max="365" step="1"
                  value={max}
                  onChange={(e) => setMax(Math.max(+e.target.value, min + 1))}
                />
              </section>

              <section className="mandate-field">
                <label>Maximum risk class</label>
                <div className="risk-ten">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
                    <button
                      key={r}
                      className={r <= risk ? 'risk-notch selected' : 'risk-notch'}
                      onClick={() => setRisk(r)}
                      type="button"
                    >{r}</button>
                  ))}
                </div>
              </section>

              <section className="mandate-field leverage-section">
                <div><label>Allow leveraged positions</label></div>
                <button
                  className={`toggle ${leverage ? 'on' : ''}`}
                  onClick={() => setLeverage(!leverage)}
                  type="button"
                ><span /></button>
              </section>
            </>
          )}
        </div>
        <div className="modal-footer">
          <p className="policy-composition">{sentence}</p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={close}>Cancel</button>
            <button
              className="primary-button create-button"
              disabled={!valid || phase === 'busy' || accounts.length === 0 ||
                (venueMode === 'selected' && selectedVenues.length === 0)}
              onClick={submit}
            >
              {phase === 'busy' ? 'Confirming…' : 'Create mandate'}
              {phase === 'busy' && <CircleDashed className="spin" size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}