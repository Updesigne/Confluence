// components/simulator/simulator-panel.tsx
'use client'
import { useState } from 'react'
import { ArrowDown, Check, ChevronRight, Link2, Sparkles } from 'lucide-react'
import { useShell } from '@/components/ui/shell/shell-context'

const MOCK_MANDATES = [
  ['#001','0x71…E4c2','$20k','60d','Class A','PASS'],
  ['#002','0xB0B…4C2','$10k','90d','Class B','PASS'],
  ['#003','0x9f…19a1','$8k','30d','90d','PASS'],
  ['#004','0x44…b18d','$0','14d','Risk 8','REJECT'],
  ['#005','0xa2…e901','$0','120d','Leverage off','REJECT'],
  ['#006','0x33…a088','$12k','60d','Venue mismatch','REJECT'],
] as const

const HASHES = ['0x8a3f…d4b1','0x6c21…91aa','0xf12c…4d10']
const ACTS = ['Scan','Filter','Match','Lock','Execute']

export function SimulatorPanel() {
  const { notify } = useShell()
  const [phase, setPhase] = useState(0)
  const [speed, setSpeed] = useState('2×')

  const run = () => {
    if (phase < 5) {
      setPhase(phase + 1)
      notify(
        phase === 3 ? 'Plan locked · 0xf12c…4d10'
        : phase === 4 ? 'Aggregate executed · 0x8b4f…a921'
        : `Act ${phase + 1} complete`
      )
    }
  }

  return (
    <div className="simulator-control">
      <div className="sim-topline">
        <div>
          <div className="eyebrow">Simulator / MockVenue · USDC Yield / Position #{phase >= 5 ? '001' : '—'}</div>
          <div className="phase-track">
            {ACTS.map((a, i) => (
              <div className={phase >= i + 1 ? 'phase done' : phase === i ? 'phase current' : 'phase'} key={a}>
                <span>{phase >= i + 1 ? <Check size={11} /> : i + 1}</span>{a}
              </div>
            ))}
          </div>
        </div>
        <div className="sim-controls">
          <div className="speed-toggle">
            {['1×','2×','4×'].map((x) => (
              <button className={speed === x ? 'active' : ''} onClick={() => setSpeed(x)} key={x}>{x}</button>
            ))}
          </div>
          <button className="ghost-button" onClick={() => setPhase(0)}>Reset</button>
          <button className="primary-button" onClick={run}>
            {phase === 0 ? 'Run simulation' : phase >= 5 ? 'Replay' : 'Next act'} <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="sim-control-grid">
        <aside className="sim-picker">
          <div className="picker-heading">
            <div><h2>Opportunities</h2><span>Pick one to simulate.</span></div>
            <span className="refresh-chip"><span className="live-dot" /> 1 available</span>
          </div>
          <div className="picker-tabs"><button className="active">DeFi</button><button>Notes</button></div>
          <button className="opportunity-card selected">
            <div className="opp-card-head"><span className="opp-glyph">∿</span><b>MockVenue · USDC Yield</b><em>OPEN</em></div>
            <div className="opp-card-copy"><span>Duration · 60 days</span><strong>$20,000.00</strong></div>
            <div className="capacity-line"><i style={{ width: '38%' }} /></div>
            <div className="opp-chips"><span>Risk 6</span><span>Liquidity 90%</span><span>Min return $0.01</span></div>
          </button>
          <button className="opportunity-card">
            <div className="opp-card-head"><span className="opp-glyph">⌁</span><b>Notes · Working capital loan</b><em>OPEN</em></div>
            <div className="opp-card-copy"><span>Borrower · 0xB0B…4C2</span><strong>$30,000.00</strong></div>
            <div className="collateral-chip">20 WETH · $60,000 · ETH $3,012.44</div>
            <div className="capacity-line"><i style={{ width: '80%' }} /></div>
            <div className="opp-chips"><span>APR 6.90%</span><span>90 days</span><span>Interest $510.41</span></div>
          </button>
          <div className="pool-tally">
            <span>OPPORTUNITY POOL</span>
            <b>2 OPEN · 1 EXECUTED · 0 CLOSED</b>
            <small>Only the two most recent are shown for demo.</small>
          </div>
        </aside>

        <main className="aggregation-canvas">
          <div className="canvas-heading">
            <div>
              <span className="act-pill">Act {phase || 0} · {phase ? ACTS[phase - 1] + 'ing' : 'Idle'}</span>
              <h2>
                {phase === 0 ? 'Select an opportunity, then press Run.'
                 : phase === 1 ? 'Scanning mandates'
                 : phase === 2 ? 'Filtering for available capital'
                 : phase === 3 ? 'Matching capital to target'
                 : phase === 4 ? 'Locking plan on-chain'
                 : 'Executed'}
              </h2>
            </div>
            <span className="canvas-live"><span className="live-dot" /> ARBITRUM SEPOLIA</span>
          </div>

          {phase === 0 ? (
            <div className="idle-control-room">
              <div className="control-node">
                <span>MANDATES</span><ArrowDown size={15} />
                <span>CAPITAL</span><ArrowDown size={15} />
                <span>OPPORTUNITY</span>
              </div>
              <p>Every policy. Every dollar. One compliant position.</p>
            </div>
          ) : (
            <div className={`act-stage act-${phase}`}>
              {phase <= 2 && (
                <div className="mandate-grid">
                  {MOCK_MANDATES.map((m, i) => (
                    <div className={`mandate-card ${m[5] === 'REJECT' ? 'rejected' : ''}`} key={m[0]}>
                      <div><b>{m[0]}</b><span>{m[1]}</span></div>
                      <strong>{m[5] === 'PASS' ? '✓' : '×'}</strong>
                      <p>Max {m[2]} · {m[3]}</p>
                      <small>{m[4]}</small>
                      {phase === 2 && m[5] === 'PASS' && <label>{i === 2 ? '$8,000' : '$' + (20 - i * 10) + ',000'} available</label>}
                    </div>
                  ))}
                </div>
              )}
              {phase === 3 && (
                <>
                  <div className="target-readout">$30,000 <small>/ $30,000 matched</small></div>
                  <div className="target-bar"><i style={{ width: '100%' }} /></div>
                  <div className="participant-row">
                    {['0x71…E4c2 · $20,000','0xB0B…4C2 · $5,000','0x9f…19a1 · $5,000 trimmed'].map((x) => (
                      <div className="participant" key={x}><span className="packet" /><b>{x}</b><small>COMMITTED</small></div>
                    ))}
                  </div>
                  <div className="match-success"><Check size={15} /> Target filled exactly · 3 participants</div>
                </>
              )}
              {phase === 4 && (
                <div className="lock-panel">
                  <div className="eyebrow">Act 4 · Locking plan on-chain</div>
                  <h2>Signing 3 transactions…</h2>
                  {['create','addParticipants','lockPlan'].map((x, i) => (
                    <div className="tx-pill" key={x}>
                      <Check size={13} /><b>{x}</b>
                      <span>success · {HASHES[i]} · Block 128,443,{102 + i}</span>
                    </div>
                  ))}
                </div>
              )}
              {phase === 5 && (
                <div className="executed-stage">
                  <div className="execution-diamond"><Sparkles size={22} /></div>
                  <span className="executed-chip"><Check size={13} /> EXECUTED</span>
                  <h2>Confluence #1</h2>
                  <p>Principal $30,000.00 · Maturity 14 Aug 2025 · Status EXECUTED</p>
                </div>
              )}
            </div>
          )}

          <div className="canvas-footer">
            <div>
              {ACTS.map((a, i) => (
                <span className={phase >= i + 1 ? 'complete' : ''} key={a}>
                  {phase >= i + 1 ? <Check size={10} /> : i + 1} {a}
                </span>
              ))}
            </div>
            {phase >= 5 && <button className="ghost-button">Phase 2 → Repayment</button>}
          </div>
        </main>

        <aside className="activity-rail">
          <div className="activity-head">
            <div><h2>Activity</h2><span>Live from Arbitrum Sepolia.</span></div>
            <span className="block-live"><span className="live-dot" /> Block 128,443,102</span>
          </div>
          <div className="activity-stats">
            <span>Session transactions <b>{phase === 0 ? 0 : phase === 5 ? 5 : phase}</b></span>
            <span>Total gas <b>0.00042 ETH</b></span>
            <span>Success rate <b className="success-text">100%</b></span>
          </div>
          {phase === 0 ? (
            <div className="empty-activity">
              <Link2 size={25} />
              <p>No transactions yet.</p>
              <small>Run a simulation to see them here.</small>
            </div>
          ) : (
            <div className="activity-list">
              {['create','addParticipants','lockPlan', ...(phase === 5 ? ['execute'] : [])].map((x, i) => (
                <div className="activity-row" key={x}>
                  <div className="status-circle"><Check size={13} /></div>
                  <div>
                    <b>{x}</b>
                    <small>{HASHES[i % 3]}</small>
                    <span>Block 128,443,{102 + i} · 0.00014 ETH · {i + 1}s ago</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="activity-footer">
            <span>SESSION</span>
            <button className="ghost-button">Copy all hashes</button>
          </div>
        </aside>
      </div>
    </div>
  )
}