'use client'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Stat } from '@/components/ui/primitives'
import { AccountsGrid } from '@/components/portfolio/accounts-grid'
import { ActivityStrip } from '@/components/portfolio/activity-strip'
import { MandatesTable } from '@/components/mandates/mandates-table'
import { useShell } from '@/components/ui/shell/shell-context'
import { useVaultAccounts } from '@/hooks/useVault'
import { useMyMandates } from '@/hooks/useMandates'

export default function PortfolioPage() {
  const { openMandateModal } = useShell()
  const { data: accounts = [] } = useVaultAccounts()
  const { data: mandates = [] } = useMyMandates()

  const totalAvailable = accounts.reduce((s, a) => s + a.available, 0n)
  const totalDeployed = accounts.reduce((s, a) => s + a.deployed, 0n)
  const totalCommitted = accounts.reduce((s, a) => s + a.committed, 0n)
  const totalValue = totalAvailable + totalDeployed + totalCommitted
  const activeMandates = mandates.filter((m) => m.active).length

  const usd = (v: bigint) =>
    `$${(Number(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle="Your policy-bound capital, accounts, and mandates."
        actions={
          <button className="primary-button" onClick={openMandateModal}>
            <Plus size={15} /> New mandate
          </button>
        }
      />
      <section className="stats-grid">
        <Stat label="Total value" value={usd(totalValue)} sub="Across all vaults" />
        <Stat label="Deployed" value={usd(totalDeployed)} sub="In active positions" />
        <Stat label="Available" value={usd(totalAvailable)} sub={`Across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`} />
        <Stat label="Active mandates" value={String(activeMandates)} sub={`${mandates.length} total`} />
      </section>
      <AccountsGrid />
      <MandatesTable />
      <ActivityStrip />
    </>
  )
}