// app/docs/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { ArrowUpRight, Copy } from 'lucide-react'
import { Logo } from '@/components/ui/primitives'

type Slide = {
  id: string; eyebrow: string; title: string; sub: string;
  kind: string; body: string[]; foot: string
}

const SLIDES: Slide[] = [
  { id:'problem', eyebrow:'Why this exists', title:'Capital has no memory of intent.', sub:'You deposit. You hope. That is not a policy.', kind:'scatter',
    body:[ 'In DeFi, capital is either handed to a manager who picks for you, or managed manually by you — one signature at a time. Neither option encodes what you actually wanted.',
           'Policy exists in your head, in a Notion doc, in a Discord thread. It does not exist in the transaction you just signed.',
           'That gap is why retail sits on the sidelines. Without enforceable policy, capital has no reason to trust an aggregator.' ],
    foot:'// today: capital is a signature, not a rule' },
  { id:'primitive', eyebrow:'The primitive', title:'A mandate is a policy that moves capital.', sub:'You write it once. The protocol enforces it forever.', kind:'mandate',
    body:[ 'A mandate is a structure you author once: which asset, which venues are allowed, how much can be deployed, and how risky it can be.',
           'Every field is stored on-chain. The mandate has an id, an owner, and a rulebook. It is not a suggestion — it is a constraint.',
           'Users sign to author their policy. The protocol does the rest.' ],
    foot:'MandateRegistry.createMandate(...)' },
  { id:'compliance', eyebrow:'How the aggregator finds your capital', title:'Scan. Filter. Only the compliant survive.', sub:'Every mandate is checked against every opportunity at match time.', kind:'scan',
    body:[ 'When the aggregator finds a market opportunity, it queries the mandate registry for every active policy.',
           'Each mandate is checked field by field: asset, venue, allocation headroom, duration, risk class, and leverage.',
           'Only mandates that return true are considered for capital. The rest are excluded.' ],
    foot:'MandateRegistry.isCompliant(id, asset, venue, amount, duration, risk, leverage)' },
  { id:'capital', eyebrow:'Where the money actually comes from', title:'Policy is not enough. Capital must be free.', sub:'A compliant mandate with no available balance contributes nothing.', kind:'capital',
    body:[ 'Capital is deployed through a per-account vault, where funds are split into available, committed, deployed, and collateralized.',
           'Only available capital can be committed to a new confluence. Committed capital is already promised elsewhere.',
           'The aggregator cannot conjure capital. It can only route what policy and balance both allow.' ],
    foot:'CapitalVault.Account { available, committed, deployed }' },
  { id:'execution', eyebrow:'Where capital goes to work', title:'Same primitive. Any venue.', sub:'DeFi positions and borrower notes are both just opportunities.', kind:'fork',
    body:[ 'An opportunity declares its asset, venue, adapter, capacity, duration, liquidity, risk class, and deadline.',
           'When a confluence executes, capital leaves the vault, moves through the Execution Router, and lands at the venue.',
           'The router knows the calls were hashed and committed before capital moved. That is the whole trust model.' ],
    foot:'ExecutionRouter.executeAggregate(..., expectedHash, deadline, principal)' },
  { id:'settlement', eyebrow:'How capital comes home', title:'The unwind is written before the deposit.', sub:'Three hashes lock the plan: execute, settle, exit.', kind:'settle',
    body:[ 'Before a token leaves the vault, three hashes are locked: execution, settlement, and emergency exit.',
           'On maturity, the settlement hash is replayed and funds return to the vault.',
           'The vault distributes pro-rata to each participant. The arithmetic is the contract.' ],
    foot:'Confluence._distribute(id) → CapitalVault.settleAggregateParticipant(...)' },
  { id:'notes', eyebrow:'The other side of the market', title:'Borrowers with skin in the game.', sub:'Collateral, duration, and purpose — all on-chain, all in policy.', kind:'note',
    body:[ 'A Note is a loan whose terms are on-chain: collateral, principal, interest, duration, maturity, and purposeHash.',
           'LTV is capped at 80% and snapshotted against a Chainlink ETH price feed.',
           'Vault mandates filter on risk class and purpose. The market clears on policy, not on sales.' ],
    foot:'Notes.createNote(requested, collateralAmount, interest, duration, purposeHash)' },
  { id:'distinction', eyebrow:'The distinction', title:'Policy as a first-class primitive.', sub:'Not a strategy. Not a vault. A rulebook that moves capital.', kind:'compare',
    body:[ 'Confluence makes risk legible: every opportunity is checked against every policy, and the checks are reproducible.',
           'It does not require trust in an operator. Capital cannot move until a plan is committed, and every plan has an exit.',
           'Borrowers write a note, post collateral, and let policy-bound mandates decide whether to fund them.' ],
    foot:'// three primitives: mandate · confluence · note' },
  { id:'closing', eyebrow:'A closing note', title:'Capital that remembers why it moved.', sub:'The policy is the promise. The chain is the witness.', kind:'loop',
    body:[ 'We built Confluence because capital allocation has been held together by trust for too long.',
           'Confluence replaces trust with a written, on-chain, machine-checkable statement of intent.',
           'This is the missing layer where capital meets real yield, with guardrails instead of guesswork.' ],
    foot:'// confluence: where policy becomes capital' },
]

export default function DocsPage() {
  const [index, setIndex] = useState(0)
  const [onePage, setOnePage] = useState(false)
  const current = SLIDES[index]

  const jump = (next: number) => {
    const n = Math.max(0, Math.min(SLIDES.length - 1, next))
    setIndex(n)
    window.history.replaceState(null, '', `/docs#${SLIDES[n].id}`)
  }

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1)
      const found = SLIDES.findIndex((s) => s.id === hash)
      if (found >= 0) setIndex(found)
    }
    sync()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') jump(index + 1)
      if (e.key === 'ArrowLeft') jump(index - 1)
      if (e.key === 'Home') jump(0)
      if (e.key === 'End') jump(SLIDES.length - 1)
    }
    window.addEventListener('hashchange', sync)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('keydown', onKey)
    }
  }, [index])

  return (
    <div className={onePage ? 'docs-shell one-page' : 'docs-shell'}>
      <div className="docs-progress"><i style={{ width: `${((index + 1) / SLIDES.length) * 100}%` }} /></div>
      <header className="docs-top">
        <button className="docs-brand" onClick={() => jump(0)}><Logo /><span>Docs</span></button>
        <div className="docs-dots">
          {SLIDES.map((s, i) => (
            <button key={s.id} aria-label={s.title} className={i === index ? 'active' : ''} onClick={() => jump(i)} title={s.title} />
          ))}
        </div>
        <a className="docs-skip" href="/portfolio">Skip to app <ArrowUpRight size={14} /></a>
      </header>
      <main className="docs-slider">
        {onePage ? SLIDES.map((s, i) => <DocsSlide key={s.id} slide={s} index={i} />) : <DocsSlide slide={current} index={index} />}
      </main>
      <footer className="docs-bottom">
        <button className="docs-mode" onClick={() => setOnePage(!onePage)}>
          {onePage ? 'View slider' : 'View as one page'}
        </button>
        <span className="docs-count">{String(index + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}</span>
        <span className="docs-current">{current.title}</span>
        <div className="docs-nav">
          <button disabled={index === 0} onClick={() => jump(index - 1)}>← Previous</button>
          <button disabled={index === SLIDES.length - 1} onClick={() => jump(index + 1)}>Next →</button>
        </div>
      </footer>
    </div>
  )
}

function DocsSlide({ slide, index }: { slide: Slide; index: number }) {
  return (
    <section className={`docs-slide docs-kind-${slide.kind}`} id={slide.id}>
      <div className="docs-copy">
        <span className="docs-eyebrow">{slide.eyebrow}</span>
        <h2>{slide.title}</h2>
        <p className="docs-sub">{slide.sub}</p>
        <div className="docs-body">{slide.body.map((p) => <p key={p}>{p}</p>)}</div>
        <button className="docs-foot" onClick={() => navigator.clipboard?.writeText(slide.foot)}>
          {slide.foot}<Copy size={12} />
        </button>
      </div>
      <div className="docs-visual">
        <div className="visual-kicker">CONFLUENCE / {String(index + 1).padStart(2, '0')}</div>
        <div className={`diagram diagram-${slide.kind}`}>
          <div className="diagram-vault">VAULT</div>
          <div className="diagram-line" />
          <div className="diagram-diamond">
            {slide.kind === 'compare' ? 'POLICY' : slide.kind === 'note' ? 'NOTE' : 'CONFLUENCE'}
          </div>
          <div className="diagram-pills">
            <span>{slide.kind === 'scan' ? '12 scanned' : 'USDC'}</span>
            <span>{slide.kind === 'capital' ? '3 funded' : 'policy-bound'}</span>
            <span>{slide.kind === 'settle' ? '+ return' : 'on-chain'}</span>
          </div>
          {slide.kind === 'compare' && (
            <div className="compare-columns">
              <div>Traditional vault<br /><small>manager discretion</small></div>
              <div>Manual DeFi<br /><small>policy in your head</small></div>
              <div className="compare-highlight">Confluence<br /><small>rules at match time</small></div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}