import { PageHeader } from '@/components/ui/page-header'
import { DemoControlRoom } from '@/components/simulator/demo-control-room'
import '@/components/simulator/demo-control-room.css'

export default function SimulatorPage() {
  return (
    <>
      <PageHeader
        title="Simulator"
        subtitle="Run the on-chain depeg and Notes lifecycles, from market signal through pro-rata settlement."
      />
      <DemoControlRoom />
    </>
  )
}