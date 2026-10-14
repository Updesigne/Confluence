'use client'
import React, { useState } from 'react'
import { Plus, Coins, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Stat } from '@/components/ui/primitives'
import { AccountsGrid } from '@/components/portfolio/accounts-grid'
import { ActivityStrip } from '@/components/portfolio/activity-strip'
import { MandatesTable } from '@/components/mandates/mandates-table'
import { UsdgFaucetCard } from '@/components/portfolio/usdg-faucet-card'
import { useShell } from '@/components/ui/shell/shell-context'
import { useVaultAccounts, useMintUsdg, useUsdgBalance } from '@/hooks/useVault'
import { useMyMandates } from '@/hooks/useMandates'
import { useWeb3 } from '@/providers/Web3Provider'

export default function PortfolioPage() {
  const { openMandateModal, notify } = useShell()
  const { address } = useWeb3()
  const { data: accounts = [], refetch: refetchAccounts } = useVaultAccounts()
  const { data: mandates = [] } = useMyMandates()
  const { data: usdgBal, refetch: refetchBal } = useUsdgBalance()
  const mintUsdg = useMintUsdg()
  const [headerMinting, setHeaderMinting] = useState(false)

  const totalAvailable = accounts.reduce((s, a) => s + a.available, 0n)
  const totalDeployed = accounts.reduce((s, a) => s + a.deployed, 0n)
  const totalCommitted = accounts.reduce((s, a) => s + a.committed, 0n)
  const totalValue = totalAvailable + totalDeployed + totalCommitted
  const activeMandates = mandates.filter((m) => m.active).length

  const usd = (v: bigint) =>
    `$${(Number(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const walletUsd = usdgBal !== undefined
    ? `$${(Number(usdgBal) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'

  const handleHeaderMint = async () => {
    if (!address) {
      return notify('Please connect your wallet first')
    }
    setHeaderMinting(true)
    notify('Minting 10,000 mock USDG to your wallet…')
    try {
      await mintUsdg(address, 10000)
      await Promise.all([refetchBal(), refetchAccounts()])
      notify('Minted 10,000 mock USDG to your wallet successfully!')
    } catch (err: any) {
      notify(err?.message || 'Failed to mint mock USDG')
    } finally {
      setHeaderMinting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle="Your policy-bound capital, accounts, and mandates."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              id="btn-header-mint-usdg"
              className="mint-usdg-btn-header"
              disabled={headerMinting}
              onClick={handleHeaderMint}
              title="Mint 10,000 mock USDG testnet tokens to caller"
            >
              {headerMinting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Minting 10,000 USDG…
                </>
              ) : (
                <>
                  <Coins size={14} /> Mint 10,000 mock USDG
                </>
              )}
            </button>
            <button className="primary-button" onClick={openMandateModal}>
              <Plus size={15} /> New mandate
            </button>
          </div>
        }
      />

      <UsdgFaucetCard />

      <section className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <Stat label="Total value" value={usd(totalValue)} sub="Across all vaults" />
        <Stat label="Deployed" value={usd(totalDeployed)} sub="In active positions" />
        <Stat label="Available" value={usd(totalAvailable)} sub={`Across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`} />
        <Stat label="Mock USDG balance" value={walletUsd} sub="Caller wallet balance" />
        <Stat label="Active mandates" value={String(activeMandates)} sub={`${mandates.length} total`} />
      </section>

      <AccountsGrid />
      <MandatesTable />
      <ActivityStrip />
    </>
  )
}