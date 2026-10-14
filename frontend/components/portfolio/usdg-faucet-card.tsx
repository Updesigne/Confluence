'use client'
import React, { useState } from 'react'
import { Coins, Sparkles, ExternalLink, Copy, Check, ArrowRight, Loader2 } from 'lucide-react'
import { useWeb3 } from '@/providers/Web3Provider'
import { useUsdgBalance, useMintUsdg } from '@/hooks/useVault'
import { useShell } from '@/components/ui/shell/shell-context'
import { shortAddr, fmtUsdc } from '@/lib/web3/format'

export function UsdgFaucetCard() {
  const { address, chainId, contracts } = useWeb3()
  const { notify } = useShell()
  const { data: balance, refetch: refetchBal, isLoading } = useUsdgBalance()
  const mintUsdg = useMintUsdg()

  const [minting, setMinting] = useState(false)
  const [customAmt, setCustomAmt] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [copied, setCopied] = useState(false)

  const usdgAddress = contracts?.addresses?.usdg || '0x3BfcBCE79FAb56B3400CB909C2B65CA00732a43B'
  const explorerUrl = chainId === 421614
    ? `https://sepolia.arbiscan.io/token/${usdgAddress}`
    : `https://arbiscan.io/token/${usdgAddress}`

  const handleCopy = () => {
    navigator.clipboard.writeText(usdgAddress)
    setCopied(true)
    notify('USDG token address copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleMint = async (amount: number = 10000) => {
    if (!address) {
      return notify('Please connect your wallet first')
    }
    setMinting(true)
    notify(`Minting ${amount.toLocaleString()} mock USDG to ${shortAddr(address)}…`)

    try {
      const result = await mintUsdg(address, amount)
      await refetchBal()
      notify(`Successfully minted ${amount.toLocaleString()} mUSDG to your wallet!`)
      if (showCustom) setCustomAmt('')
    } catch (err: any) {
      console.error('Mint USDG error:', err)
      notify(err?.message || 'Failed to mint mock USDG')
    } finally {
      setMinting(false)
    }
  }

  const formattedBal = balance !== undefined
    ? `$${(Number(balance) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—'

  return (
    <section className="section" style={{ marginBottom: 28 }} id="section-mock-usdg">
      <div className="section-heading">
        <div>
          <h2>Mock USDG Capital & Balance</h2>
          <span className="muted">Your active testnet USDG balance • Mint funds to deposit into vaults or back mandates</span>
        </div>
      </div>
      <div className="usdg-faucet-card" id="usdg-faucet-banner">
      <div className="faucet-info-group">
        <div className="faucet-icon-wrap">
          <Coins size={22} />
        </div>
        <div>
          <div className="faucet-meta-title">
            <span>Caller Wallet Balance</span>
            <span className="faucet-token-badge">mUSDG</span>
            <button
              type="button"
              onClick={handleCopy}
              className="copy-button"
              style={{ fontSize: 10, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              title="Copy mUSDG token address"
            >
              {copied ? <Check size={11} color="var(--green)" /> : <Copy size={11} />}
              <span>{shortAddr(usdgAddress)}</span>
            </button>
          </div>
          <div className="faucet-balance-val">
            <span>{isLoading ? 'Loading…' : formattedBal}</span>
          </div>
          <div className="faucet-subtext">
            {address ? (
              <span>
                Connected as <b style={{ color: 'var(--text)' }}>{shortAddr(address)}</b> on Arbitrum Sepolia. Available for vault deposits and mandate backing.{' '}
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  View token contract <ExternalLink size={10} style={{ display: 'inline', verticalAlign: 'middle' }} />
                </a>
              </span>
            ) : (
              <span>Connect your wallet to mint and fund your accounts with mock USDG.</span>
            )}
          </div>
        </div>
      </div>

      <div className="faucet-actions-group">
        {showCustom ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              placeholder="Amount"
              value={customAmt}
              onChange={(e) => setCustomAmt(e.target.value)}
              className="input-field"
              style={{ width: 110, height: 32, padding: '0 8px', fontSize: 12, borderRadius: 6 }}
            />
            <button
              type="button"
              className="mint-usdg-btn-primary"
              disabled={minting || !customAmt || parseFloat(customAmt) <= 0}
              onClick={() => handleMint(parseFloat(customAmt))}
            >
              {minting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Mint
            </button>
            <button
              type="button"
              className="secondary-button"
              style={{ padding: '6px 8px', fontSize: 11 }}
              onClick={() => setShowCustom(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="faucet-chips">
              <button
                type="button"
                className="faucet-chip-btn"
                disabled={minting || !address}
                onClick={() => handleMint(1000)}
                title="Mint 1,000 USDG"
              >
                +1,000
              </button>
              <button
                type="button"
                className="faucet-chip-btn"
                disabled={minting || !address}
                onClick={() => handleMint(10000)}
                title="Mint 10,000 USDG"
              >
                +10,000
              </button>
              <button
                type="button"
                className="faucet-chip-btn"
                disabled={minting || !address}
                onClick={() => handleMint(50000)}
                title="Mint 50,000 USDG"
              >
                +50,000
              </button>
              <button
                type="button"
                className="faucet-chip-btn"
                disabled={minting || !address}
                onClick={() => setShowCustom(true)}
                title="Mint custom amount"
              >
                Custom…
              </button>
            </div>

            <button
              type="button"
              id="btn-mint-mock-usdg"
              className="mint-usdg-btn-primary"
              disabled={minting || !address}
              onClick={() => handleMint(10000)}
            >
              {minting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Minting…</span>
                </>
              ) : (
                <>
                  <Coins size={14} />
                  <span>Mint 10,000 USDG</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
    </section>
  )
}
