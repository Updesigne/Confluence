'use client'
import { useEffect, useState } from 'react'
import { Check, CircleDashed, ExternalLink, X } from 'lucide-react'
import { Hash } from '@/components/ui/primitives'
import { useShell } from '@/components/ui/shell/shell-context'
import { useWeb3 } from '@/providers/Web3Provider'
import { useVaultAccounts } from '@/hooks/useVault'
import { useCreateMandate } from '@/hooks/useMandates'
import { parseUsdc } from '@/lib/web3/format'
import type { TransactionReceipt } from 'ethers'

export function MandateModal({
  close,
  track,
}: {
  close: () => void
  track?: (label: string, send: () => Promise<TransactionReceipt | null>) => Promise<TransactionReceipt | null>
}) {
  const { notify } = useShell()
  const { contracts, address } = useWeb3()
  const { data: accounts = [] } = useVaultAccounts()
  const createMandate = useCreateMandate()

  const [capital, setCapital] = useState('50000')
  const [venueChoice, setVenueChoice] = useState<'Any venue' | 'Notes only' | 'Specific venue'>('Any venue')
  const [specific, setSpecific] = useState('')
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
    (venueChoice !== 'Specific venue' || /^0x[a-fA-F0-9]{40}$/.test(specific))

  const sentence = `Commit up to $${display || '0'} USDG to ${venueChoice.toLowerCase()}, maturities ${min}–${max} days, max risk class ${risk}, liquidity floor ${liquidity}%, ${leverage ? 'with' : 'without'} leverage.`

  const submit = async () => {
    if (!valid || !contracts || !address) return
    setPhase('busy')
    try {
      const venueAddr =
        venueChoice === 'Specific venue' ? specific
        : venueChoice === 'Notes only' ? contracts.addresses.notes
        : '0x0000000000000000000000000000000000000000'

      const send = () =>
        createMandate({
          accountId: BigInt(accountId),
          asset: contracts.addresses.usdc,
          venue: venueAddr,
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
    } catch (e: any) {
      notify(e?.shortMessage ?? e?.message ?? 'Transaction failed')
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
                <label>Where may this capital go?</label>
                {(['Any venue', 'Notes only', 'Specific venue'] as const).map((v) => (
                  <button
                    key={v}
                    className={`venue-card ${venueChoice === v ? 'selected' : ''}`}
                    onClick={() => setVenueChoice(v)}
                    type="button"
                  >
                    <span className="radio-dot" />
                    <span><b>{v}</b></span>
                  </button>
                ))}
                {venueChoice === 'Specific venue' && (
                  <input
                    className="venue-input"
                    value={specific}
                    onChange={(e) => setSpecific(e.target.value)}
                    placeholder="0x venue contract address"
                  />
                )}
              </section>

              <section className="mandate-field">
                <label>Duration window</label>
                <div className="range-readout">
                  <span>Min: <b>{min} days</b></span>
                  <span>Max: <b>{max} days</b></span>
                </div>
                <input
                  className="range" type="range" min="30" max="365" step="5"
                  value={max}
                  onChange={(e) => setMax(Math.max(+e.target.value, min + 5))}
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
              disabled={!valid || phase === 'busy' || accounts.length === 0}
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