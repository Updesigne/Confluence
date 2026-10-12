'use client'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity, ArrowUpRight, Bell, BookOpen, Check, ChevronRight, Copy,
  ExternalLink, FileText, LayoutGrid, Menu, Search, Settings2, ShieldCheck,
  Wallet, X, Zap,
} from 'lucide-react'
import { ShellContext, type ShellApi } from '@/components/ui/shell/shell-context'
import { MandateModal } from '@/components/ui/shell/mandate-modal'
import { Hash, Logo } from '@/components/ui/primitives'
import { useWeb3 } from '@/providers/Web3Provider'
import { useTxTracker, type TrackedTx } from '@/hooks/useTxTracker'
import { shortAddr, shortHash } from '@/lib/web3/format'
import { getVenueOptions } from '@/lib/web3/venues'

const NAV = [
  { label: 'Portfolio',     href: '/portfolio',     icon: LayoutGrid },
  { label: 'Mandates',      href: '/mandates',      icon: ShieldCheck },
  { label: 'Opportunities', href: '/opportunities', icon: Search },
  { label: 'Notes',         href: '/notes',         icon: FileText },
  { label: 'Simulator',     href: '/simulator',     icon: Zap },
  { label: 'Activity',      href: '/activity',      icon: Activity },
  { label: 'Docs',          href: '/docs',          icon: BookOpen },
] as const

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { address, chainId, connecting, connect, disconnect, error: walletError } = useWeb3()
  const { txs, track } = useTxTracker()
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState('')

  const notify = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(''), 3200)
  }, [])

  useEffect(() => {
    if (walletError) notify(walletError)
  }, [walletError, notify])

  const api: ShellApi = useMemo(() => ({
    notify,
    openMandateModal: () => setModal(true),
    openTxDrawer: () => setDrawer(true),
  }), [notify])

  const chainLabel =
    chainId === 421614 ? 'Arbitrum Sepolia'
    : chainId === 31337 ? 'Hardhat Local'
    : chainId ? `Chain ${chainId}` : 'Not connected'

  return (
    <ShellContext.Provider value={api}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <Logo />
            <span>confluence</span>
            <span className="brand-beta">BETA</span>
          </div>
          <div className="topbar-center">
            <div className="network">
              <span className="live-dot" /> {chainLabel}
            </div>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications"><Bell size={17} /><i /></button>
            {address ? (
              <button className="wallet connected" onClick={disconnect} title="Click to disconnect">
                <Wallet size={15} /> {shortAddr(address)}
              </button>
            ) : (
              <button className="wallet" onClick={connect} disabled={connecting}>
                <Wallet size={15} />
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
            <button className="avatar">
              {address ? address.slice(2, 4).toUpperCase() : '—'}
            </button>
          </div>
        </header>

        <aside className="rail">
          <div className="rail-top"><button className="rail-menu" aria-label="Menu"><Menu size={17} /></button></div>
          <nav>
            {NAV.map(({ label, href, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <button key={href} className={active ? 'rail-item active' : 'rail-item'} onClick={() => router.push(href)} title={label}>
                  <Icon size={18} /><span>{label}</span>
                </button>
              )
            })}
          </nav>
          <div className="rail-bottom">
            <button className="rail-item" title="Settings"><Settings2 size={18} /><span>Settings</span></button>
          </div>
        </aside>

        <main className="main-content">{children}</main>

        <button className={drawer ? 'tx-toggle open' : 'tx-toggle'} onClick={() => setDrawer(!drawer)}>
          <Activity size={14} />
          <span>{txs.length} transaction{txs.length === 1 ? '' : 's'}</span>
          <ChevronRight size={14} />
        </button>

        {drawer && <TxDrawer txs={txs} onClose={() => setDrawer(false)} chainId={chainId} />}
        {modal && <MandateModal close={() => setModal(false)} track={track} venues={getVenueOptions(chainId ?? 0)} />}
        {toast && <div className="toast"><Check size={14} />{toast}</div>}
      </div>
    </ShellContext.Provider>
  )
}

function TxDrawer({
  txs, onClose, chainId,
}: {
  txs: TrackedTx[]; onClose: () => void; chainId: number | null
}) {
  const explorer =
    chainId === 421614 ? 'https://sepolia.arbiscan.io'
    : chainId === 31337 ? '' : 'https://arbiscan.io'

  return (
    <aside className="tx-drawer">
      <div className="drawer-header">
        <div>
          <span className="eyebrow">Session activity</span>
          <h2>Transactions</h2>
        </div>
        <button onClick={onClose}><X size={17} /></button>
      </div>
      <div className="drawer-session">
        <span className="live-dot" /> Current session
        <span>{txs.filter((t) => t.status === 'confirmed').length} confirmed</span>
      </div>
      {txs.length === 0 && (
        <div className="empty-activity">
          <p>No transactions yet.</p>
          <small>Actions you sign will appear here.</small>
        </div>
      )}
      {txs.map((t) => (
        <div className="drawer-tx" key={t.timestamp}>
          <div className="tx-icon"><Check size={13} /></div>
          <div className="tx-info">
            <div><b>{t.label}</b><span className="confirmed">{t.status}</span></div>
            {t.hash && <Hash value={shortHash(t.hash)} />}
            {t.blockNumber && <small>Block {t.blockNumber} · {t.gasUsed} gas</small>}
            {t.hash && explorer && (
              <a href={`${explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer">
                View on explorer <ExternalLink size={11} />
              </a>
            )}
            {t.error && <small className="error-text">{t.error}</small>}
          </div>
        </div>
      ))}
      {txs.length > 0 && (
        <button
          className="copy-all"
          onClick={() =>
            navigator.clipboard?.writeText(txs.filter((t) => t.hash).map((t) => t.hash).join('\n'))
          }
        >
          <Copy size={13} /> Copy all hashes
        </button>
      )}
    </aside>
  )
}