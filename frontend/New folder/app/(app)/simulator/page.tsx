import { PageHeader } from '@/components/ui/page-header'
import { SimulatorPanel } from '@/components/simulator/simulator-panel'

export default function SimulatorPage() {
  return (
    <>
      <PageHeader
        title="Simulator"
        subtitle="Preview how mandates match, commit, and execute against an opportunity."
      />
      <SimulatorPanel />
    </>
  )
}