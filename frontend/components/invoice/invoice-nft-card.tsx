'use client'
import React, { useState } from 'react'
import {
  ShieldCheck,
  FileText,
  Lock,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Calendar,
  Building,
  User,
  ArrowUpRight,
} from 'lucide-react'
import type { InvoiceNftMetadata } from '@/hooks/useNotes'
import { shortAddr, fmtUsdc, tsToDate } from '@/lib/web3/format'
import { useShell } from '@/components/ui/shell/shell-context'

export function InvoiceNftCard({
  metadata,
  linkedNoteId,
  onSelect,
}: {
  metadata: InvoiceNftMetadata
  linkedNoteId?: bigint | string | null
  onSelect?: () => void
}) {
  const { notify } = useShell()
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    notify(`Copied ${label} to clipboard`)
    setTimeout(() => setCopied(null), 2000)
  }

  const advancePct = (metadata.advanceRateBps / 100).toFixed(0)
  const maxBorrow = (metadata.invoiceAmount * BigInt(metadata.advanceRateBps)) / 10_000n

  return (
    <div className="invoice-nft-card" id={`invoice-nft-${metadata.tokenId.toString()}`}>
      {/* Top Banner / Holographic Rim */}
      <div className="nft-card-topbar">
        <div className="nft-badge">
          <Sparkles size={12} className="nft-sparkle" />
          <span>cINV #{metadata.tokenId.toString()}</span>
        </div>
        <div className="custody-pill" title="Locked in Notes contract as loan collateral">
          <Lock size={11} />
          <span>Notes Custody</span>
        </div>
      </div>

      {/* Visual Collateral Illustration */}
      <div className="nft-art-canvas">
        <div className="art-glow" />
        <div className="art-grid-overlay" />
        <div className="art-centerpiece">
          <div className="art-document-icon">
            <FileText size={38} className="doc-icon-svg" />
            <span className="doc-stamp">VERIFIED</span>
          </div>
          <div className="art-token-ring">
            <div className="ring-pulse" />
          </div>
        </div>

        <div className="art-footer-strip">
          <div className="cre-verified-tag">
            <ShieldCheck size={13} />
            <span>Chainlink CRE Certified</span>
          </div>
          <span className="art-grade">
            Score: {metadata.riskScore}/100 {metadata.riskScore <= 35 ? '• Low Risk' : ''}
          </span>
        </div>
      </div>

      {/* Financial Details Section */}
      <div className="nft-body">
        <div className="nft-financials">
          <div>
            <span className="eyebrow">INVOICE FACE VALUE</span>
            <b className="val-amount">{fmtUsdc(metadata.invoiceAmount)}</b>
          </div>
          <div className="right-align">
            <span className="eyebrow">ADVANCE CAPACITY</span>
            <b className="val-advance">
              {fmtUsdc(maxBorrow)} <small>({advancePct}%)</small>
            </b>
          </div>
        </div>

        <div className="nft-divider" />

        {/* Counterparty & Metadata Info */}
        <div className="nft-meta-grid">
          <div className="meta-item">
            <span className="meta-label">
              <Building size={11} /> Debtor (Payer)
            </span>
            <button
              type="button"
              className="meta-value-btn"
              onClick={() => copyToClipboard(metadata.debtor, 'Debtor Address')}
            >
              {shortAddr(metadata.debtor)}
              {copied === 'Debtor Address' ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>

          <div className="meta-item">
            <span className="meta-label">
              <Calendar size={11} /> Due Date
            </span>
            <span className="meta-value">
              {metadata.dueDate > 0n ? tsToDate(metadata.dueDate) : 'On File'}
            </span>
          </div>

          <div className="meta-item">
            <span className="meta-label">Invoice Hash</span>
            <button
              type="button"
              className="meta-value-btn"
              onClick={() => copyToClipboard(metadata.invoiceHash, 'Invoice Hash')}
            >
              {metadata.invoiceHash.slice(0, 8)}…{metadata.invoiceHash.slice(-6)}
              {copied === 'Invoice Hash' ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>

          <div className="meta-item">
            <span className="meta-label">Verified At</span>
            <span className="meta-value">
              {metadata.verifiedAt > 0n ? tsToDate(metadata.verifiedAt) : 'Recent'}
            </span>
          </div>
        </div>

        {/* IPFS Evidence Document Link */}
        {metadata.pdfUri && (
          <div className="nft-doc-row">
            <span className="doc-link-text">
              <FileText size={12} />
              <span>Evidence URI: {metadata.pdfUri.slice(0, 24)}…</span>
            </span>
            <a
              href={metadata.pdfUri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${metadata.pdfUri.replace('ipfs://', '')}` : metadata.pdfUri}
              target="_blank"
              rel="noreferrer"
              className="doc-ext-link"
            >
              Inspect <ExternalLink size={11} />
            </a>
          </div>
        )}

        {/* Actions / Linked Note */}
        {linkedNoteId ? (
          <div className="nft-linked-note">
            <span>Backing Active Note</span>
            <b>#{linkedNoteId.toString()}</b>
          </div>
        ) : onSelect ? (
          <button type="button" className="primary-button full select-nft-btn" onClick={onSelect}>
            Select as Note Collateral <ArrowUpRight size={13} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
