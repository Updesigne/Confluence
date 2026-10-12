'use client'
import type { ReactNode } from 'react'
import { ChevronRight, CircleDashed } from 'lucide-react'
import { useShell } from '@/components/ui/shell/shell-context'

export function PageHeader({
  title, subtitle, actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  const { notify } = useShell()
  return (
    <div className="page-header">
      <div>
        <div className="breadcrumb">
          <span>Workspace</span>
          <ChevronRight size={13} />
          <span>{title}</span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="header-actions">
        <button className="secondary-button" onClick={() => notify('Data refreshed')}>
          <CircleDashed size={14} /> Refresh
        </button>
        {actions}
      </div>
    </div>
  )
}