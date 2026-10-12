'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check, ChevronRight, Copy } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { useShell } from '@/components/ui/shell/shell-context'
import { useWeb3 } from '@/providers/Web3Provider'
import { useCreateNote, useEthPrice } from '@/hooks/useNotes'
import { parseUsdc, parseWeth } from '@/lib/web3/format'
import { useTxTracker } from '@/hooks/useTxTracker'

export default function CreateNotePage() {
  const router = useRouter()
  const { notify } = useShell()
  const { contracts, address } = useWeb3()
  const createNote = useCreateNote()
  const { track } = useTxTracker()
  const { data: ethPrice } = useEthPrice()

  const [collateral, setCollateral] = useState('20')
  const [ltv, setLtv] = useState('80')
  const [duration, setDuration] = useState('90')
  const [rapidDemoTerm, setRapidDemoTerm] = useState(false)
  const [purpose, setPurpose] = useState('Working capital for market-making desk.')
  const [category, setCategory] = useState('Working capital')
  const [formula, setFormula] = useState(false)
  const [created, setCreated] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [createdNoteId, setCreatedNoteId] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)

  const eth = Number(ethPrice ?? 0n) / 1e8
  const c = Number(collateral) || 0
  const l = Math.min(Number(ltv) || 0, 80)
  const durationValue = Number(duration) || 0
  const durationSeconds = rapidDemoTerm ? Math.trunc(durationValue) : Math.trunc(durationValue * 86400)
  const d = rapidDemoTerm ? durationValue / 86400 : durationValue
  const loan = (c * eth * l) / 100

  const PURPOSE_PREMIUM: Record<string, number> = {
    Arbitrage: 0.5, Bridge: 1, Treasury: -0.25, Other: 1.5, 'Working capital': 0,
  }
  const apr = Math.min(18, 4.5 + d * 0.01 + 1.5 + (PURPOSE_PREMIUM[category] ?? 0))
  const interest = (loan * apr * d) / 36500
  const total = loan + interest
  const valid = c > 0 && l > 0 && eth > 0 && !!address &&
    (rapidDemoTerm ? durationSeconds >= 30 && durationSeconds <= 3600 : durationValue >= 30 && durationValue <= 365)

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const maturity = new Date(Date.now() + Math.max(durationSeconds, 0) * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  useEffect(() => {
    localStorage.setItem(
      'confluence.notes.draft',
      JSON.stringify({ collateral, ltv, duration, purpose, category })
    )
  }, [collateral, ltv, duration, purpose, category])

  const submit = async () => {
    if (!contracts) return notify('Connect your wallet first')
    setBusy(true)
    notify('Confirm in wallet…')
    try {
      const noteId = await contracts?.notes.nextNoteId() as bigint | undefined
      const receipt = await createNote({
          requested: parseUsdc(loan.toFixed(2)),
          collateralAmount: parseWeth(collateral),
          interest: parseUsdc(interest.toFixed(2)),
          duration: BigInt(durationSeconds),
        }, track)
      setTxHash(receipt?.hash ?? '')
      setCreatedNoteId(noteId ?? null)
      setCreated(true)
      notify('Note created')
    } catch (e: any) {
      notify(e?.shortMessage ?? e?.message ?? 'Transaction failed')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <>
        <PageHeader title="Note created" subtitle="Your policy-bound loan is ready for vault mandates to fund." />
        <section className="form-card note-success">
          <div className="success-mark"><Check size={25} /></div>
          <div className="eyebrow">Transaction confirmed</div>
          <h2>Note created.</h2>
          <div className="success-table">
            {createdNoteId !== null && <span>Note ID <b>#{createdNoteId.toString()}</b></span>}
            <span>Collateral <b>{c.toFixed(2)} WETH</b></span>
            <span>Loan <b>{money(loan)}</b></span>
            <span>APR <b>{apr.toFixed(2)}%</b></span>
            <span>Total due <b>{money(total)}</b></span>
            <span>Duration <b>{rapidDemoTerm ? `${durationSeconds} seconds` : `${durationValue} days`}</b></span>
            <span>Transaction <b>{txHash ? `${txHash.slice(0, 10)}…` : '—'}</b></span>
          </div>
          <button className="primary-button full" onClick={() => router.push('/notes')}>
            Back to notes <ArrowUpRight size={14} />
          </button>
          {createdNoteId !== null && (
            <button className="secondary-button full" onClick={() => router.push(`/simulator?noteId=${createdNoteId.toString()}`)}>
              Continue demo in Simulator <ArrowUpRight size={14} />
            </button>
          )}
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Create note"
        subtitle="Request a collateralized loan under transparent, on-chain terms."
        actions={<button className="secondary-button" onClick={() => router.push('/notes')}>Back to notes</button>}
      />
      <section className="create-note-form">
        <div className="eyebrow">Borrower request</div>
        <h2>Set your note terms.</h2>
        <p className="muted">Your loan is priced from the live on-chain collateral feed. {eth > 0 ? 'Amounts update with the latest feed price.' : 'Waiting for a valid on-chain ETH/USD price.'}</p>

        <div className="note-field">
          <label htmlFor="collateral">WETH collateral <span className="field-sub">Collateral is held by the Notes contract until repayment or settlement.</span></label>
          <div className="input-field"><input id="collateral" type="number" min="0.01" step="0.01" value={collateral} onChange={(event) => setCollateral(event.target.value)} /><span>WETH</span></div>
          <div className="quick-chips">
            {[5, 10, 20, 50].map((amount) => (
              <button type="button" key={amount} className={collateral === String(amount) ? 'active-chip' : ''} onClick={() => setCollateral(String(amount))}>{amount} WETH</button>
            ))}
          </div>
        </div>

        <div className="note-field">
          <label htmlFor="ltv">Loan-to-value <span className="field-sub">Maximum LTV is capped at 80% by the protocol.</span></label>
          <div className="input-field"><input id="ltv" type="number" min="1" max="80" step="1" value={ltv} onChange={(event) => setLtv(event.target.value)} /><span>%</span></div>
          <div className="ltv-track"><i style={{ width: `${Math.min(Math.max(l, 0), 80) / 80 * 100}%`, background: l > 65 ? 'var(--amber)' : 'var(--violet)' }} /></div>
        </div>

        <div className="note-field">
          <label htmlFor="duration">Duration <span className="field-sub">Choose 30–365 days, or enable the short testnet demo term.</span></label>
          <div className="category-row">
            <button type="button" className={!rapidDemoTerm ? 'active-chip' : ''} onClick={() => { setRapidDemoTerm(false); setDuration('90') }}>Standard term</button>
            <button type="button" className={rapidDemoTerm ? 'active-chip' : ''} onClick={() => { setRapidDemoTerm(true); setDuration('120') }}>Rapid demo</button>
          </div>
          <div className="input-field"><input id="duration" type="number" min={rapidDemoTerm ? '30' : '30'} max={rapidDemoTerm ? '3600' : '365'} step="1" value={duration} onChange={(event) => setDuration(event.target.value)} /><span>{rapidDemoTerm ? 'seconds' : 'days'}</span></div>
          <div className="quick-chips">
            {(rapidDemoTerm ? [60, 120, 300] : [30, 90, 180, 365]).map((value) => (
              <button type="button" key={value} className={duration === String(value) ? 'active-chip' : ''} onClick={() => setDuration(String(value))}>{value} {rapidDemoTerm ? 'sec' : 'days'}</button>
            ))}
          </div>
        </div>

        <div className="note-field">
          <label>Purpose category</label>
          <div className="category-row">
            {Object.keys(PURPOSE_PREMIUM).map((option) => (
              <button type="button" key={option} className={category === option ? 'active-chip' : ''} onClick={() => setCategory(option)}>{option}</button>
            ))}
          </div>
        </div>

        <div className="note-field">
          <label htmlFor="purpose">Purpose details <span className="field-sub">A short description helps capital providers assess your request.</span></label>
          <textarea id="purpose" rows={3} maxLength={280} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
          <small className="field-sub">{purpose.length}/280 characters</small>
        </div>

        <div className="derived-panel">
          <label>Estimated loan amount</label>
          <div className="derived-value">{money(loan)}</div>
          <small>Using the on-chain ETH/USD feed at {money(eth)} per ETH.</small>
          <div className="interest-grid">
            <div><small>Indicative APR</small><b>{apr.toFixed(2)}%</b></div>
            <div><small>Estimated interest</small><b>{money(interest)}</b></div>
            <div><small>Estimated total due</small><b>{money(total)}</b></div>
            <div><small>Estimated maturity</small><b>{maturity}</b></div>
          </div>
          <button type="button" className="formula-toggle" onClick={() => setFormula(!formula)}>
            {formula ? 'Hide estimate details' : 'How is this estimated?'} <ChevronRight size={13} />
          </button>
          {formula && <small className="field-sub">Loan = collateral × indicative ETH price × LTV. Interest uses the displayed APR and term; final eligibility and pricing are determined on-chain.</small>}
        </div>

        {!address && <p className="error-text">Connect a wallet before submitting a note.</p>}
        {address && !contracts && <p className="error-text">No deployment is configured for this network.</p>}
        <button className="primary-button full" disabled={!valid || busy || !contracts} onClick={submit}>
          {busy ? 'Confirming…' : 'Create note'} <ArrowUpRight size={14} />
        </button>
        <small className="field-sub">By creating this note, you authorize the contract to hold the specified WETH collateral.</small>
      </section>
    </>
  )
}