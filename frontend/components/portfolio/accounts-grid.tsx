'use client'
import { useState } from 'react'
import { ArrowUpRight, Box, Plus } from 'lucide-react'
import { Status } from '@/components/ui/primitives'
import { useVaultAccounts, useCreateVaultAccount, useDeposit } from '@/hooks/useVault'
import { parseUsdc } from '@/lib/web3/format'
import { useWeb3 } from '@/providers/Web3Provider'
import { useTxTracker } from '@/hooks/useTxTracker'

export function AccountsGrid() {
  const { address } = useWeb3()
  const { data: accounts = [], isLoading } = useVaultAccounts()
  const createAccount = useCreateVaultAccount()
  const { track } = useTxTracker()

  if (!address) {
    return (
      <section className="section">
        <div className="notes-empty">
          <Box size={26} />
          <h3>Connect your wallet</h3>
          <p className="muted">Connect to view your vault accounts.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h2>Vault accounts</h2>
          <span className="muted">Capital held under your control</span>
        </div>
        <button
          className="primary-button"
          onClick={async () => { try { await track('vault.createAccount', createAccount) } catch (error: unknown) { alert(error instanceof Error ? error.message : 'Transaction failed') } }}
        >
          <Plus size={14} /> New account
        </button>
      </div>

      {isLoading ? (
        <div className="muted">Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="notes-empty">
          <Box size={26} />
          <h3>No vault accounts yet</h3>
          <button className="primary-button" onClick={() => track('vault.createAccount', createAccount)}>
            <Plus size={14} /> Create your first account
          </button>
        </div>
      ) : (
        <div className="account-grid">
          {accounts.map((a) => (
            <AccountCard
              key={a.id.toString()}
              id={a.id}
              available={a.available}
              committed={a.committed}
              deployed={a.deployed}
              active={a.active}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AccountCard({
  id, available, committed, deployed, active,
}: {
  id: bigint; available: bigint; committed: bigint; deployed: bigint; active: boolean
}) {
  const deposit = useDeposit()
  const { track } = useTxTracker()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const total = available + committed + deployed
  const pct = total > 0n ? Number((deployed * 100n) / total) : 0

  return (
    <div className="account-card">
      <div className="account-top">
        <span className="account-name">
          <Box size={15} /> Vault #{id.toString().padStart(3, '0')}
        </span>
        <Status>{active ? 'Active' : 'Inactive'}</Status>
      </div>
      <div className="account-value">
        ${(Number(total) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="account-meta">
        <span>Deployed <b>${(Number(deployed) / 1e6).toFixed(2)}</b></span>
        <span>Available <b>${(Number(available) / 1e6).toFixed(2)}</b></span>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="account-actions">
        <input
          className="input-field"
          style={{ width: 100, height: 28, padding: '0 8px', fontSize: 11 }}
          placeholder="USDC"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <button
          disabled={busy || !amount}
          onClick={async () => {
            setBusy(true)
            try { await deposit(id, parseUsdc(amount), track); setAmount('') }
            catch (error: unknown) { alert(error instanceof Error ? error.message : 'Transaction failed') }
            finally { setBusy(false) }
          }}
        >
          {busy ? '…' : 'Deposit'}
        </button>
        <span className="account-id">ID {id.toString()}</span>
      </div>
    </div>
  )
}