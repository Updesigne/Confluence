import { Copy } from 'lucide-react'

export function Logo() {
  return (
    <div className="logo-mark" aria-label="Confluence">
      <span /><span /><span />
    </div>
  )
}

export function Hash({ value }: { value: string }) {
  return (
    <button className="hash" type="button">
      <span>{value}</span>
      <Copy size={12} />
    </button>
  )
}

export function Stat({
  label, value, sub, positive,
}: {
  label: string; value: string; sub: string; positive?: boolean
}) {
  return (
    <div className="stat">
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={positive ? 'delta positive' : 'delta'}>{sub}</div>
    </div>
  )
}

export function Status({ children }: { children: string }) {
  const isActive = children === 'Active' || children === 'OPEN' || children === 'Confirmed'
  return (
    <span className={isActive ? 'state active-state' : 'state paused-state'}>
      <span />
      {children}
    </span>
  )
}