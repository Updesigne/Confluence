'use client'
import { Plus, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Stat } from '@/components/ui/primitives'
import { MandatesTable } from '@/components/mandates/mandates-table'
import { useShell } from '@/components/ui/shell/shell-context'
import { useMyMandates } from '@/hooks/useMandates'

export default function MandatesPage() {
  const { openMandateModal } = useShell()
  const { data: mandates = [] } = useMyMandates()

  const active = mandates.filter((m) => m.active).length
  const governed = mandates.reduce((s, m) => s + m.maxAllocation, 0n)
  const reserved = mandates.reduce((s, m) => s + m.reserved, 0n)

  const usd = (v: bigint) => `$${(Number(v) / 1e6).toLocaleString('en-US')}`

  return (
    <>
      <PageHeader
        title="Mandates"
        subtitle="Rules that govern where your capital can move."
        actions={
          <button className="primary-button" onClick={openMandateModal}>
            <Plus size={15} /> New mandate
          </button>
        }
      />
      <section className="stats-grid">
        <Stat label="Policies authored" value={String(mandates.length)} sub={`${active} active`} />
        <Stat label="Capital governed" value={usd(governed)} sub="Across all mandates" />
        <Stat label="Reserved" value={usd(reserved)} sub="Currently committed" />
        <Stat label="Policy compliance" value="100%" sub="No violations" positive />
      </section>
      <MandatesTable />
      <div className="empty-card">
        <ShieldCheck size={22} />
        <div>
          <h3>Need another policy?</h3>
          <p>Author a mandate and keep every allocation inside your rules.</p>
        </div>
        <button className="primary-button" onClick={openMandateModal}>
          <Plus size={14} /> Create mandate
        </button>
      </div>
    </>
  )
}