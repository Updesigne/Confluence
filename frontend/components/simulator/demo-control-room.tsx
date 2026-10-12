'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Contract, Interface, ZeroAddress, ZeroHash } from 'ethers'
import { ArrowDown, ArrowUpRight, Check, Coins, ExternalLink, RefreshCw, Rocket, ShieldCheck, Zap } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useShell } from '@/components/ui/shell/shell-context'
import { useMyMandates, type Mandate } from '@/hooks/useMandates'
import { useNotes } from '@/hooks/useNotes'
import { useOpportunities, type Opportunity } from '@/hooks/useOpportunities'
import { useVaultAccounts } from '@/hooks/useVault'
import { useTxTracker } from '@/hooks/useTxTracker'
import { fmtUsdc, parseUsdc, shortAddr } from '@/lib/web3/format'
import { useWeb3 } from '@/providers/Web3Provider'

const USDG = new Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function transfer(address to,uint256 amount) returns (bool)',
])
const DEPEG = new Interface([
  'function open(uint256 usdgIn,uint256 minUsdcOut) returns (uint256 hedgeId,uint256 usdcOut)',
  'function close(uint256 hedgeId,uint256 minUsdgOut) returns (uint256 usdgOut)',
])
const NOTES = new Interface([
  'function draw(uint256 noteId,uint256 amount)',
  'function markRepaid(uint256 noteId) returns (uint256)',
])
const ZERO = ZeroAddress.toLowerCase()

type Contribution = { mandate: Mandate; accountId: bigint; amount: bigint }

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'shortMessage' in error && typeof error.shortMessage === 'string') {
    return error.shortMessage
  }
  return error instanceof Error ? error.message : 'Transaction failed'
}

export function DemoControlRoom() {
  const router = useRouter()
  const { contracts, address, chainId, provider, signer } = useWeb3()
  const { notify } = useShell()
  const { txs, track } = useTxTracker()
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useVaultAccounts()
  const { data: mandates = [] } = useMyMandates()
  const { data: opportunities = [], isLoading: opportunitiesLoading } = useOpportunities()
  const { data: notes = [] } = useNotes()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<'depeg' | 'notes'>('depeg')
  const [amount, setAmount] = useState('5000')
  const [depegBps, setDepegBps] = useState('30')
  const [durationSeconds, setDurationSeconds] = useState('120')
  const [noteIdInput, setNoteIdInput] = useState(searchParams.get('noteId') ?? '')
  const [selectedOpportunity, setSelectedOpportunity] = useState('')
  const [busy, setBusy] = useState(false)
  const [positionId, setPositionId] = useState<bigint | null>(null)

  const notesAddress = contracts?.addresses.notes
  const depegAddress = contracts?.addresses.depegAdapter
  const openOpportunities = useMemo(
    () => opportunities.filter((opportunity) => opportunity.status === 0),
    [opportunities]
  )
  const relevantOpportunities = useMemo(
    () => openOpportunities.filter((opportunity) =>
      tab === 'depeg'
        ? opportunity.venue.toLowerCase() === depegAddress?.toLowerCase()
        : opportunity.venue.toLowerCase() === notesAddress?.toLowerCase()
    ),
    [openOpportunities, tab, depegAddress, notesAddress]
  )
  const selected = relevantOpportunities.find((opportunity) => opportunity.id.toString() === selectedOpportunity)
  const deployConfigured = !!contracts && [
    contracts.addresses.pool,
    contracts.addresses.usdg,
    contracts.addresses.depegAdapter,
    contracts.addresses.notes,
    contracts.addresses.opportunities,
  ].every((entry) => entry.toLowerCase() !== ZERO)

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['notes'] }),
        queryClient.invalidateQueries({ queryKey: ['vault'] }),
        queryClient.invalidateQueries({ queryKey: ['mandates'] }),
      ])
      notify(`${label} confirmed`)
    } catch (error: unknown) {
      notify(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const publishDepegOpportunity = async () => {
    if (!contracts) throw new Error('Connect to a configured deployment first')
    const capacity = parseUsdc(amount)
    const bps = BigInt(depegBps)
    if (capacity <= 0n || bps <= 0n || bps > 500n) throw new Error('Enter capital above zero and a depeg signal from 1–500 bps')
    const currentBlock = await provider?.getBlock('latest')
    if (!currentBlock) throw new Error('Could not read the latest block')
    const nextId = await contracts.opportunities.nextOpportunityId() as bigint
    const price = 1_000_000n + (bps * 1_000_000n) / 10_000n
    await track('depeg.setPrice', async () => {
      const tx = await contracts.pool.setPrice(price)
      return tx.wait()
    })
    await track('opportunities.create(depeg)', async () => {
      const tx = await contracts.opportunities.createOpportunity({
        asset: await contracts.vault.asset(),
        venue: contracts.addresses.depegAdapter,
        adapter: contracts.addresses.depegAdapter,
        capacity,
        duration: BigInt(durationSeconds),
        liquidityBps: 10_000n,
        riskClass: 1,
        usesLeverage: false,
        minReturn: capacity,
        deadline: BigInt(currentBlock.timestamp + 7_200),
        metadataHash: ZeroHash,
        venueRefId: 0n,
      })
      return tx.wait()
    })
    setSelectedOpportunity(nextId.toString())
  }

  const restorePeg = async () => {
    if (!contracts) throw new Error('Connect to a configured deployment first')
    await track('depeg.restorePeg', async () => {
      const tx = await contracts.pool.setPrice(1_000_000n)
      return tx.wait()
    })
  }

  const mintDemoAssets = async () => {
    if (!contracts || !signer || !address) throw new Error('Connect a wallet first')
    const tokenOwner = new Contract(contracts.addresses.usdg, ['function mint(address,uint256)'], signer)
    const wethToken = new Contract(contracts.addresses.weth, ['function mint(address,uint256)'], signer)
    await track('demo.mintUSDG', async () => {
      const tx = await tokenOwner.mint(address, parseUsdc('10000'))
      return tx.wait()
    })
    await track('demo.mintWETH', async () => {
      const tx = await wethToken.mint(address, 2n * 10n ** 18n)
      return tx.wait()
    })
    await queryClient.invalidateQueries({ queryKey: ['usdg', 'balance', address] })
  }

  const publishNoteOpportunity = async () => {
    if (!contracts) throw new Error('Connect to a configured deployment first')
    if (!/^\d+$/.test(noteIdInput)) throw new Error('Enter a valid note ID')
    const noteId = BigInt(noteIdInput)
    const note = await contracts.notes.getNote(noteId)
    if (Number(note.status) !== 0) throw new Error('Only an open, unfunded note can be published for funding')
    const publisher = await contracts.opportunities.protocolOwner() as string
    const enabled = await contracts.adapterRegistry.isEnabled(publisher, contracts.addresses.notes) as boolean
    if (!enabled) throw new Error('Notes adapter is not enabled for the protocol publisher in AdapterRegistry')
    const latestBlock = await provider?.getBlock('latest')
    if (!latestBlock) throw new Error('Could not read the latest block')
    const nextId = await contracts.opportunities.nextOpportunityId() as bigint
    await track('opportunities.create(note)', async () => {
      const tx = await contracts.opportunities.createOpportunity({
        asset: await contracts.notes.asset(),
        venue: contracts.addresses.notes,
        adapter: publisher,
        capacity: note.requested,
        duration: note.duration,
        liquidityBps: 10_000n,
        riskClass: 1,
        usesLeverage: false,
        minReturn: note.requested,
        deadline: BigInt(latestBlock.timestamp) + note.duration + 7_200n,
        metadataHash: note.purposeHash,
        venueRefId: noteId,
      })
      return tx.wait()
    })
    setSelectedOpportunity(nextId.toString())
  }

  const selectContributors = async (opportunity: Opportunity): Promise<Contribution[]> => {
    if (!contracts || !address) throw new Error('Connect a wallet first')
    const candidates: Contribution[] = []
    const usedAccounts = new Set<string>()
    let remaining = opportunity.capacity - opportunity.allocated

    for (const account of accounts) {
      if (remaining === 0n) break
      const accountKey = account.id.toString()
      if (usedAccounts.has(accountKey) || account.available === 0n) continue
      const accountMandates = mandates.filter((mandate) =>
        mandate.accountId === account.id && mandate.active &&
        mandate.asset.toLowerCase() === opportunity.asset.toLowerCase()
      )

      for (const mandate of accountMandates) {
        const policyRemaining = mandate.maxAllocation > mandate.reserved
          ? mandate.maxAllocation - mandate.reserved
          : 0n
        const contribution = [account.available, policyRemaining, remaining]
          .reduce((smallest, value) => value < smallest ? value : smallest)
        if (contribution === 0n) continue
        const compliant = await contracts.mandates.isCompliant(
          mandate.id,
          opportunity.asset,
          opportunity.venue,
          contribution,
          opportunity.duration,
          opportunity.liquidityBps,
          opportunity.riskClass,
          opportunity.usesLeverage
        ) as boolean
        if (!compliant) continue

        candidates.push({ mandate, accountId: account.id, amount: contribution })
        usedAccounts.add(accountKey)
        remaining -= contribution
        break
      }
    }

    if (candidates.length === 0) throw new Error('No active, compliant mandate account has available capital for this opportunity')
    if (remaining > 0n) {
      throw new Error(`The opportunity needs ${fmtUsdc(remaining)} more compliant capital. Deposit to another account or reduce the opportunity size.`)
    }
    return candidates
  }

  const fundWithConfluence = async () => {
    if (!contracts || !selected) throw new Error('Select an open demo opportunity')
    const contributions = await selectContributors(selected)
    const target = contributions.reduce((sum, contribution) => sum + contribution.amount, 0n)
    if (selected.venue.toLowerCase() === notesAddress?.toLowerCase() && target !== selected.capacity) {
      throw new Error(`Notes funding needs the full request (${fmtUsdc(selected.capacity)}); compliant accounts currently cover ${fmtUsdc(target)}`)
    }

    const block = await provider?.getBlock('latest')
    if (!block) throw new Error('Could not read the latest block')
    const executionDeadline = BigInt(block.timestamp + 90)
    const maturityFloor = contributions.reduce((floor, contribution) => {
      const mandateFloor = executionDeadline + contribution.mandate.minDuration
      return mandateFloor > floor ? mandateFloor : floor
    }, BigInt(block.timestamp) + selected.duration)
    const maturity = selected.venue.toLowerCase() === notesAddress?.toLowerCase()
      ? (maturityFloor > BigInt(block.timestamp) + selected.duration + 120n
        ? maturityFloor
        : BigInt(block.timestamp) + selected.duration + 120n)
      : maturityFloor
    for (const contribution of contributions) {
      if (maturity > BigInt(block.timestamp) + contribution.mandate.maxDuration) {
        throw new Error(`Mandate #${contribution.mandate.id} max duration is too short for this plan; author a longer window`)
      }
    }
    const settlementDeadline = maturity + 3_600n
    const nextPositionId = await contracts.confluence.nextId() as bigint
    await track('confluence.create', async () => {
      const tx = await contracts.confluence.create(
        selected.id,
        target,
        selected.minReturn,
        executionDeadline,
        settlementDeadline
      )
      return tx.wait()
    })

    for (const contribution of contributions) {
      await track(`confluence.addParticipant account #${contribution.accountId}`, async () => {
        const tx = await contracts.confluence.addParticipant(
          nextPositionId,
          contribution.accountId,
          contribution.mandate.id,
          contribution.amount
        )
        return tx.wait()
      })
    }

    const depeg = selected.venue.toLowerCase() === depegAddress?.toLowerCase()
    const expectedHedgeId = depeg
      ? await contracts.depegAdapter.nextHedgeId() as bigint
      : 0n
    const calls: Array<{ target: string; value: bigint; data: string }> = depeg
      ? [
          {
            target: selected.asset,
            value: 0n,
            data: USDG.encodeFunctionData('approve', [selected.adapter, target]),
          },
          {
            target: selected.adapter,
            value: 0n,
            data: DEPEG.encodeFunctionData('open', [target, 1n]),
          },
        ]
      : [
          {
              target: selected.asset,
              value: 0n,
            data: USDG.encodeFunctionData('transfer', [selected.venue, target]),
          },
          {
            target: selected.venue,
            value: 0n,
            data: NOTES.encodeFunctionData('draw', [selected.venueRefId, target]),
          },
        ]
    const settlementCalls: Array<{ target: string; value: bigint; data: string }> = depeg
      ? [{
          target: selected.adapter,
          value: 0n,
          data: DEPEG.encodeFunctionData('close', [expectedHedgeId, selected.minReturn]),
        }]
      : [{
          target: selected.venue,
          value: 0n,
          data: NOTES.encodeFunctionData('markRepaid', [selected.venueRefId]),
        }]
    const executionHash = await contracts.router.hashCalls(calls) as string
    const settlementHash = await contracts.router.hashCalls(settlementCalls) as string
    const plan = {
      executionHash,
      settlementHash,
      emergencySettlementHash: settlementHash,
      positionMetadataHash: ZeroHash,
      maturity,
      emergencyMinReturn: selected.minReturn,
    }

    await track('confluence.lockPlan', async () => {
      const tx = await contracts.confluence.lockPlan(nextPositionId, plan)
      return tx.wait()
    })
    await track('confluence.execute', async () => {
      const tx = await contracts.confluence.execute(nextPositionId, calls)
      return tx.wait()
    })
    setPositionId(nextPositionId)
  }

  const settleWithConfluence = async () => {
    if (!contracts || !selected) throw new Error('Select the opportunity tied to the executed position')
    const linkedPosition = positionId ?? await contracts.opportunities.opportunityPosition(selected.id) as bigint
    if (linkedPosition === 0n) throw new Error('No Confluence position is bound to this opportunity yet')
    const position = await contracts.confluence.positions(linkedPosition)
    if (Number(position.status) !== 2) throw new Error('Confluence position must be executed before settlement')
    let calls: Array<{ target: string; value: bigint; data: string }>

    if (selected.venue.toLowerCase() === depegAddress?.toLowerCase()) {
      const nextHedgeId = await contracts.depegAdapter.nextHedgeId() as bigint
      const candidates = await Promise.all(Array.from({ length: Number(nextHedgeId - 1n) }, async (_, index) => {
        const hedgeId = BigInt(index + 1)
        const candidate = [{
          target: selected.adapter,
          value: 0n,
          data: DEPEG.encodeFunctionData('close', [hedgeId, selected.minReturn]),
        }]
        const hash = await contracts.router.hashCalls(candidate) as string
        return hash.toLowerCase() === position.settlementHash.toLowerCase() ? candidate : null
      }))
      const match = candidates.find((candidate) => candidate !== null)
      if (!match) throw new Error('No open depeg hedge matches the position’s locked settlement hash')
      calls = match
    } else {
      calls = [{
        target: selected.venue,
        value: 0n,
        data: NOTES.encodeFunctionData('markRepaid', [selected.venueRefId]),
      }]
      const hash = await contracts.router.hashCalls(calls) as string
      if (hash.toLowerCase() !== position.settlementHash.toLowerCase()) {
        throw new Error('This Notes position has a different locked settlement plan')
      }
    }
    await track('confluence.settle', async () => {
      const tx = await contracts.confluence.settle(linkedPosition, calls)
      return tx.wait()
    })
    setPositionId(null)
  }

  const selectedNote = notes.find((note) => note.id.toString() === noteIdInput)
  const activeChain = chainId === 421614 ? 'Arbitrum Sepolia' : chainId === 31337 ? 'Hardhat Local' : `Chain ${chainId ?? '—'}`
  const explorer = chainId === 421614 ? 'https://sepolia.arbiscan.io' : chainId === 31337 ? '' : 'https://arbiscan.io'

  return (
    <div className="demo-room">
      <section className="demo-hero">
        <div>
          <span className="eyebrow">Live protocol walkthrough · {activeChain}</span>
          <h2>From market signal to settled capital.</h2>
          <p>Every control below calls the connected deployment. Signed transactions appear in the live activity feed and link to the network explorer.</p>
        </div>
        <span className="live-dot" />
      </section>

      {!address && <div className="warning-card">Connect the protocol operator wallet to publish opportunities and run aggregator actions.</div>}
      {address && !deployConfigured && <div className="warning-card">This network has no deployment configuration. Add the deployed pool, USDG, registry, router, and protocol addresses first.</div>}

      {address && deployConfigured && (
        <button className="secondary-button" disabled={busy} onClick={() => void run('Demo assets', mintDemoAssets)}>
          <Coins size={14} /> Mint 10,000 mock USDG + 2 mock WETH
        </button>
      )}

      <div className="demo-tabs">
        <button className={tab === 'depeg' ? 'active' : ''} onClick={() => setTab('depeg')}><Zap size={14} /> Depeg strategy</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}><ShieldCheck size={14} /> Notes strategy</button>
      </div>

      {tab === 'depeg' ? (
        <section className="demo-step-grid">
          <article className="demo-step-card">
            <span className="demo-step-index">01 · SIGNAL</span>
            <h3>Trigger stablecoin depeg</h3>
            <p>Set the mock USDG/USDC pool price and publish an OPEN depeg opportunity on-chain.</p>
            <label>Demo capital</label>
            <div className="input-field"><input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /><span>USDG</span></div>
            <label>Depeg size</label>
            <div className="input-field"><input value={depegBps} onChange={(event) => setDepegBps(event.target.value.replace(/\D/g, ''))} inputMode="numeric" /><span>bps</span></div>
            <label>Opportunity duration</label>
            <div className="input-field"><input value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value.replace(/\D/g, ''))} inputMode="numeric" /><span>seconds</span></div>
            <button className="primary-button full" disabled={busy || !deployConfigured || !address} onClick={() => void run('Depeg opportunity', publishDepegOpportunity)}>
              <Zap size={14} /> Trigger depeg + publish
            </button>
            <button className="secondary-button full" disabled={busy || !deployConfigured || !address} onClick={() => void run('Repeg', restorePeg)}>
              <RefreshCw size={14} /> Repeg to $1.00
            </button>
          </article>
          <OpportunitySelector opportunities={relevantOpportunities} selected={selectedOpportunity} onSelect={setSelectedOpportunity} isLoading={opportunitiesLoading} />
          <ConfluenceActions
            disabled={busy || !deployConfigured || !selected || !address}
            positionId={positionId}
            selected={selected}
            onFund={() => void run('Confluence execution', fundWithConfluence)}
            onSettle={() => void run('Confluence settlement', settleWithConfluence)}
          />
        </section>
      ) : (
        <section className="demo-step-grid">
          <article className="demo-step-card">
            <span className="demo-step-index">01 · BORROWER</span>
            <h3>Create a note first</h3>
            <p>Use the Notes page to publish collateral and loan terms. For a live demo, select the short demo-term option.</p>
            <button className="secondary-button full" onClick={() => router.push('/notes/create')}>
              Create note <ArrowUpRight size={14} />
            </button>
            <label>Open note ID</label>
            <div className="input-field"><input value={noteIdInput} onChange={(event) => setNoteIdInput(event.target.value.replace(/\D/g, ''))} placeholder="e.g. 1" inputMode="numeric" /><span>Note ID</span></div>
            <div className="muted">{selectedNote ? `Request ${fmtUsdc(selectedNote.requested)} · ${selectedNote.duration.toString()} seconds · status ${selectedNote.status}` : 'Enter an open note ID to publish its funding opportunity.'}</div>
            <button className="primary-button full" disabled={busy || !deployConfigured || !selectedNote || !address} onClick={() => void run('Notes opportunity', publishNoteOpportunity)}>
              <ShieldCheck size={14} /> Publish notes funding opportunity
            </button>
          </article>
          <OpportunitySelector opportunities={relevantOpportunities} selected={selectedOpportunity} onSelect={setSelectedOpportunity} isLoading={opportunitiesLoading} />
          <ConfluenceActions
            disabled={busy || !deployConfigured || !selected || !address}
            positionId={positionId}
            selected={selected}
            onFund={() => void run('Notes funding', fundWithConfluence)}
            onSettle={() => void run('Notes settlement', settleWithConfluence)}
          />
        </section>
      )}

      <section className="demo-architecture">
        <div><span className="demo-step-index">ON-CHAIN ARCHITECTURE</span><h3>One auditable lifecycle</h3></div>
        <div className="architecture-flow">
          {['Market signal', 'OpportunityRegistry', 'Mandate compliance', 'CapitalVault', 'Confluence plan', 'ExecutionRouter', 'Pro-rata settlement'].map((label, index) => (
            <div key={label}><span>{String(index + 1).padStart(2, '0')}</span><b>{label}</b>{index < 6 && <ArrowDown size={13} />}</div>
          ))}
        </div>
      </section>

      <section className="demo-activity">
        <div className="section-heading"><div><h2>Live transaction activity</h2><span className="muted">Actual receipts from this browser session</span></div></div>
        {txs.length === 0 ? <p className="muted">No transactions yet. Start with the market signal or create an account.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Action</th><th>Status</th><th>Transaction</th><th>Block</th><th>Explorer</th></tr></thead><tbody>
            {txs.map((tx) => <tr key={tx.timestamp}><td className="mono">{tx.label}</td><td>{tx.status}</td><td className="mono">{tx.hash ? shortAddr(tx.hash) : tx.error ?? 'Awaiting wallet…'}</td><td>{tx.blockNumber ?? '—'}</td><td>{tx.hash && explorer ? <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" className="hash">View on explorer <ExternalLink size={12} /></a> : '—'}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  )
}

function OpportunitySelector({
  opportunities, selected, onSelect, isLoading,
}: {
  opportunities: Opportunity[]
  selected: string
  onSelect: (id: string) => void
  isLoading: boolean
}) {
  return (
    <article className="demo-step-card">
      <span className="demo-step-index">02 · OPPORTUNITY</span>
      <h3>Select an OPEN opportunity</h3>
      {isLoading ? <p className="muted">Loading opportunity registry…</p> : opportunities.length === 0 ? (
        <p className="muted">No matching OPEN opportunity yet. Trigger a depeg or publish a note funding opportunity.</p>
      ) : opportunities.map((opportunity) => (
        <button key={opportunity.id.toString()} className={`demo-opportunity ${selected === opportunity.id.toString() ? 'selected' : ''}`} onClick={() => onSelect(opportunity.id.toString())}>
          <span><b>#{opportunity.id.toString()} · {shortAddr(opportunity.venue)}</b><small>{fmtUsdc(opportunity.capacity)} capacity · {opportunity.duration.toString()}s · min return {fmtUsdc(opportunity.minReturn)}</small></span>
          {selected === opportunity.id.toString() && <Check size={15} />}
        </button>
      ))}
    </article>
  )
}

function ConfluenceActions({
  disabled, positionId, selected, onFund, onSettle,
}: {
  disabled: boolean
  positionId: bigint | null
  selected?: Opportunity
  onFund: () => void
  onSettle: () => void
}) {
  return (
    <article className="demo-step-card">
      <span className="demo-step-index">03 · AGGREGATION</span>
      <h3>Confluence funds</h3>
      <p>Scan connected vault accounts and active mandates, add compliant participants, commit execution and settlement hashes, then execute the locked route.</p>
      <div className="demo-flow-status"><span className="live-dot" /> {selected ? `Opportunity #${selected.id.toString()} selected` : 'Select an opportunity to continue'}</div>
      <button className="primary-button full" disabled={disabled} onClick={onFund}><Rocket size={14} /> Confluence funds + execute</button>
      <div className="demo-flow-status">Position {positionId ? `#${positionId.toString()} · awaiting settlement` : '—'}</div>
      <button className="secondary-button full" disabled={disabled} onClick={onSettle}><Check size={14} /> Settle and distribute</button>
      <small className="field-helper">Settlement is permissionless after plan maturity. Depeg must be repegged; Notes must have a deposited repayment.</small>
    </article>
  )
}
