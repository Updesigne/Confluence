'use client'
import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  ShieldCheck,
  Lock,
  Sparkles,
  Zap,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  Search,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { useShell } from '@/components/ui/shell/shell-context'
import { useWeb3 } from '@/providers/Web3Provider'
import {
  useOffChainCollateral,
  useInvoiceRequest,
  useAllInvoiceNfts,
  useRequestInvoiceVerification,
  useCreateNoteWithInvoice,
} from '@/hooks/useNotes'
import { useTxTracker } from '@/hooks/useTxTracker'
import { shortAddr, shortHash, fmtUsdc } from '@/lib/web3/format'
import { InvoiceNftCard } from '@/components/invoice/invoice-nft-card'

const DEFAULT_POLICY = '0x2222222222222222222222222222222222222222222222222222222222222222'
const DEFAULT_PURPOSE = '0x3333333333333333333333333333333333333333333333333333333333333333'
const DEFAULT_DEBTOR = '0x0000000000000000000000000000000000000002'
const DEFAULT_ISSUER = '0x0000000000000000000000000000000000000001'
const DEFAULT_PDF_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111'
const DEFAULT_PDF_URI = 'ipfs://bafybeicg5invoiceevidencereceivablehash001'

export default function InvoiceLoanPage() {
  const router = useRouter()
  const { notify } = useShell()
  const { contracts, address, chainId } = useWeb3()
  const { track } = useTxTracker()

  const requestVerification = useRequestInvoiceVerification()
  const createNoteWithInvoice = useCreateNoteWithInvoice()
  const { data: allNfts = [], refetch: refetchNfts } = useAllInvoiceNfts()

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'flow' | 'nfts' | 'info'>('flow')

  // Step Tracker: 1 = Submit API, 2 = Request Onchain, 3 = Deliver CRE Report, 4 = Mint & Note
  const [currentStep, setCurrentStep] = useState<number>(1)

  // Invoice Form Fields
  const [invoiceId, setInvoiceId] = useState('INV-003')
  const [debtor, setDebtor] = useState(DEFAULT_DEBTOR)
  const [issuer, setIssuer] = useState(DEFAULT_ISSUER)
  const [invoiceAmountUsd, setInvoiceAmountUsd] = useState('35000') // $35,000 USDC
  const [dueDate, setDueDate] = useState('2027-01-01T00:00:00Z')
  const [pdfHash, setPdfHash] = useState(DEFAULT_PDF_HASH)
  const [pdfUri, setPdfUri] = useState(DEFAULT_PDF_URI)

  // Loan Request Fields
  const [requestedUsd, setRequestedUsd] = useState('1000') // $1,000 USDC
  const [interestUsd, setInterestUsd] = useState('10') // $10 USDC
  const [durationDays, setDurationDays] = useState('30')
  const [rapidDemoTerm, setRapidDemoTerm] = useState(false)
  const [policyHash, setPolicyHash] = useState(DEFAULT_POLICY)
  const [purposeHash, setPurposeHash] = useState(DEFAULT_PURPOSE)

  // Processing & State tracking
  const [submittingApi, setSubmittingApi] = useState(false)
  const [submittingOnchain, setSubmittingOnchain] = useState(false)
  const [deliveringReport, setDeliveringReport] = useState(false)
  const [creatingNote, setCreatingNote] = useState(false)

  // State generated from flow
  const [invoiceHash, setInvoiceHash] = useState<string>('')
  const [evidenceHash, setEvidenceHash] = useState<string>('')
  const [requestId, setRequestId] = useState<string>('')
  const [requestTxHash, setRequestTxHash] = useState<string>('')
  const [reportTxHash, setReportTxHash] = useState<string>('')
  const [noteId, setNoteId] = useState<string | null>(null)
  const [noteTxHash, setNoteTxHash] = useState<string>('')
  const [createdNftId, setCreatedNftId] = useState<string | null>(null)

  // Live queries for active request and collateral
  const { data: activeRequest, refetch: refetchReq } = useInvoiceRequest(requestId || null)
  const { data: activeCollateral, refetch: refetchColl } = useOffChainCollateral(invoiceHash || null)

  const explorer = chainId === 421614 ? 'https://sepolia.arbiscan.io' : 'https://arbiscan.io'

  // Auto-advance steps based on on-chain query state
  useEffect(() => {
    if (activeRequest) {
      if (activeRequest.processed && activeRequest.approved) {
        if (currentStep < 4) setCurrentStep(4)
      } else if (!activeRequest.processed) {
        if (currentStep < 3) setCurrentStep(3)
      }
    }
  }, [activeRequest, currentStep])

  // Fill sample data
  const handleLoadSample = (sampleNum: number = 3) => {
    setInvoiceId(`INV-00${sampleNum}`)
    setInvoiceAmountUsd('35000')
    setRequestedUsd('1000')
    setInterestUsd('10')
    setDurationDays('30')
    setDebtor(DEFAULT_DEBTOR)
    setIssuer(address || DEFAULT_ISSUER)
    setPdfHash(DEFAULT_PDF_HASH)
    setPdfUri(`ipfs://bafybeicg5invoiceevidence00${sampleNum}`)
    setPolicyHash(DEFAULT_POLICY)
    setPurposeHash(DEFAULT_PURPOSE)
    notify(`Loaded Sample Invoice #00${sampleNum}`)
  }

  // Load existing Request #2 (which was pre-verified on testnet)
  const handleResumeRequest2 = () => {
    setRequestId('2')
    setInvoiceHash('0xa50d5c33ec756cf20e7cd9d93b615e8cf2b21a8f8e21a6636722bf696e2bfbd2')
    setEvidenceHash('0xd7f42d0fac3c3ab78cfa6019bf45fe52bf83f35cd757745fef743365f39e7e8b')
    setRequestedUsd('1000')
    setInterestUsd('10')
    setDurationDays('30')
    setCurrentStep(4)
    notify('Loaded existing on-chain verified request #2')
  }

  // Step 1: Submit to Evidence Mock API
  const handleSubmitToApi = async () => {
    if (!address) return notify('Connect wallet first')
    setSubmittingApi(true)
    notify('Submitting invoice evidence to API…')

    try {
      // Amount in smallest units (USDC has 6 decimals)
      const amountUnits = (BigInt(Math.floor(Number(invoiceAmountUsd) || 0)) * 1_000_000n).toString()

      const payload = {
        invoiceId,
        issuer: issuer || address,
        debtor,
        amount: amountUnits,
        dueDate,
        invoicePdfHash: pdfHash,
        borrowerAddress: address,
        currency: 'USDC',
      }

      const res = await fetch('/api/invoice/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to submit invoice to API')
      }

      setInvoiceHash(data.invoiceHash)
      setEvidenceHash(data.evidenceHash)
      setCurrentStep(2)
      notify('Evidence submitted! Invoice and evidence hashes generated.')
    } catch (err: any) {
      notify(err.message || 'Evidence submission failed')
    } finally {
      setSubmittingApi(false)
    }
  }

  // Step 2: Request On-Chain Verification
  const handleRequestOnchain = async () => {
    if (!contracts || !address) return notify('Connect wallet first')
    if (!invoiceHash || !evidenceHash) return notify('Submit invoice to API first')

    setSubmittingOnchain(true)
    notify('Confirming on-chain verification request…')

    try {
      const requestedUnits = BigInt(Math.floor(Number(requestedUsd) || 0)) * 1_000_000n
      const interestUnits = BigInt(Math.floor(Number(interestUsd) || 0)) * 1_000_000n
      const durationSeconds = rapidDemoTerm
        ? BigInt(Math.trunc(Number(durationDays) || 60))
        : BigInt(Math.trunc((Number(durationDays) || 30) * 86400))

      const receipt = await requestVerification(
        {
          invoiceHash,
          evidenceHash,
          policyHash,
          purposeHash,
          requested: requestedUnits,
          interest: interestUnits,
          duration: durationSeconds,
        },
        track
      )

      let resolvedRequestId: string | null = null
      if (receipt) {
        setRequestTxHash(receipt.hash)
        for (const log of receipt.logs) {
          try {
            const parsed = contracts.notes.interface.parseLog(log)
            if (parsed && parsed.name === 'InvoiceVerificationRequested') {
              resolvedRequestId = parsed.args.requestId.toString()
              break
            }
          } catch {}
        }
      }

      if (!resolvedRequestId) {
        try {
          const next = (await contracts.notes.nextInvoiceRequestId()) as bigint
          if (next > 1n) resolvedRequestId = (next - 1n).toString()
        } catch {}
      }

      if (resolvedRequestId) {
        setRequestId(resolvedRequestId)
        setCurrentStep(3)
        await refetchReq()
        notify(`Verification requested! Request ID #${resolvedRequestId}`)
        // Automatically dispatch Chainlink CRE trigger right after requesting verification (as 05-request-invoice-verification.ts does)
        handleDeliverCreReport(resolvedRequestId, invoiceHash)
      } else {
        notify('Transaction confirmed on-chain')
      }
    } catch (err: any) {
      notify(err?.reason ?? err?.message ?? 'Request failed')
    } finally {
      setSubmittingOnchain(false)
    }
  }

  // Step 3: Deliver Chainlink CRE Verification Report
  const handleDeliverCreReport = async (overrideId?: string, overrideHash?: string) => {
    const idToUse = overrideId || requestId
    const hashToUse = overrideHash || invoiceHash
    if (!idToUse) return notify('Need valid request ID')
    setDeliveringReport(true)
    notify('Dispatching trigger to Chainlink CRE simulator…')

    try {
      const res = await fetch('/api/invoice/deliver-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: idToUse, invoiceHash: hashToUse }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Chainlink CRE report delivery failed')
      }

      setReportTxHash(data.txHash || '')

      if (data.pending) {
        notify('Chainlink CRE triggered! Awaiting on-chain consensus confirmation…')
        // Poll for confirmation
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          const reqRes = await refetchReq()
          const collRes = await refetchColl()
          if (reqRes.data?.processed && reqRes.data?.approved) {
            setCurrentStep(4)
            notify('Chainlink CRE verified report confirmed on-chain! Collateral approved.')
            return
          }
        }
      } else {
        setCurrentStep(4)
        await refetchReq()
        await refetchColl()
        notify('Chainlink CRE verified report delivered on-chain! Collateral approved.')
      }
    } catch (err: any) {
      notify(err.message || 'Chainlink CRE report delivery failed')
    } finally {
      setDeliveringReport(false)
    }
  }

  // Step 4: Create Note with Invoice
  const handleCreateNoteWithInvoice = async () => {
    if (!contracts || !address) return notify('Connect wallet first')
    if (!invoiceHash) return notify('Invoice hash missing')

    setCreatingNote(true)
    notify('Confirm note creation in wallet…')

    try {
      const requestedUnits = BigInt(Math.floor(Number(requestedUsd) || 0)) * 1_000_000n
      const interestUnits = BigInt(Math.floor(Number(interestUsd) || 0)) * 1_000_000n
      const durationSeconds = rapidDemoTerm
        ? BigInt(Math.trunc(Number(durationDays) || 60))
        : BigInt(Math.trunc((Number(durationDays) || 30) * 86400))

      const receipt = await createNoteWithInvoice(
        {
          invoiceHash,
          requested: requestedUnits,
          interest: interestUnits,
          duration: durationSeconds,
          purposeHash,
          policyHash,
          pdfUri,
        },
        track
      )

      let resolvedNoteId: string | null = null
      let resolvedTokenId: string | null = null

      if (receipt) {
        setNoteTxHash(receipt.hash)
        for (const log of receipt.logs) {
          try {
            const parsed = contracts.notes.interface.parseLog(log)
            if (parsed && parsed.name === 'InvoiceNoteCreated') {
              resolvedNoteId = parsed.args.noteId.toString()
              resolvedTokenId = parsed.args.invoiceTokenId.toString()
              break
            }
          } catch {}
        }
      }

      if (!resolvedNoteId) {
        try {
          const next = (await contracts.notes.nextNoteId()) as bigint
          if (next > 1n) resolvedNoteId = (next - 1n).toString()
        } catch {}
      }

      setNoteId(resolvedNoteId)
      setCreatedNftId(resolvedTokenId)
      await refetchNfts()
      await refetchColl()
      notify('Invoice Note created on-chain! Invoice NFT minted into Notes custody.')
    } catch (err: any) {
      notify(err?.reason ?? err?.message ?? 'Transaction failed')
    } finally {
      setCreatingNote(false)
    }
  }

  // Derived calculations
  const invAmtNum = Number(invoiceAmountUsd) || 0
  const reqAmtNum = Number(requestedUsd) || 0
  const intAmtNum = Number(interestUsd) || 0
  const ltvRatio = invAmtNum > 0 ? ((reqAmtNum / invAmtNum) * 100).toFixed(1) : '0'

  return (
    <>
      <PageHeader
        title="Invoice Financing"
        subtitle="Tokenize enterprise receivables into on-chain collateral verified by Chainlink CRE."
        actions={
          <div className="header-actions">
            <button
              className={activeTab === 'flow' ? 'primary-button' : 'secondary-button'}
              onClick={() => setActiveTab('flow')}
            >
              <FileText size={14} /> Create Invoice Loan
            </button>
            <button
              className={activeTab === 'nfts' ? 'primary-button' : 'secondary-button'}
              onClick={() => setActiveTab('nfts')}
            >
              <Sparkles size={14} /> Minted Invoice NFTs ({allNfts.length})
            </button>
            <button className="secondary-button" onClick={() => router.push('/notes')}>
              Back to Notes
            </button>
          </div>
        }
      />

      {/* Hero Strip */}
      <div className="notes-hero" style={{ marginBottom: 20 }}>
        <div>
          <span className="eyebrow">Real World Asset Credit</span>
          <h2>Invoice Policy Loans with Chainlink CRE</h2>
          <p>
            Cryptographically binding invoices to verified off-chain evidence. Evaluated by Chainlink
            CRE policy, minting custodial Invoice NFTs into the Notes protocol.
          </p>
        </div>
        <div className="notes-hero-actions">
          <button className="secondary-button" onClick={() => handleLoadSample(3)} title="Load test invoice data">
            <RefreshCw size={13} /> Load Sample Invoice
          </button>
          <button className="secondary-button" onClick={handleResumeRequest2} title="Load pre-approved request #2">
            <Zap size={13} /> Load Request #2
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      {activeTab === 'flow' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)', gap: 24 }}>
          {/* Left: Step Form & Workflow */}
          <section className="create-note-form" style={{ width: '100%', margin: 0 }}>
            {/* Step navigation tabs */}
            <div className="invoice-stepper">
              <button
                type="button"
                className={`invoice-step-tab ${currentStep === 1 ? 'active' : currentStep > 1 ? 'completed' : ''}`}
                onClick={() => setCurrentStep(1)}
              >
                <span className="step-num">{currentStep > 1 ? '✓' : '1'}</span>
                <span>Evidence API</span>
              </button>

              <button
                type="button"
                className={`invoice-step-tab ${currentStep === 2 ? 'active' : currentStep > 2 ? 'completed' : ''}`}
                onClick={() => setCurrentStep(2)}
              >
                <span className="step-num">{currentStep > 2 ? '✓' : '2'}</span>
                <span>Borrower Request</span>
              </button>

              <button
                type="button"
                className={`invoice-step-tab ${currentStep === 3 ? 'active' : currentStep > 3 ? 'completed' : ''}`}
                onClick={() => setCurrentStep(3)}
              >
                <span className="step-num">{currentStep > 3 ? '✓' : '3'}</span>
                <span>CRE Report</span>
              </button>

              <button
                type="button"
                className={`invoice-step-tab ${currentStep === 4 ? 'active' : ''}`}
                onClick={() => setCurrentStep(4)}
              >
                <span className="step-num">4</span>
                <span>Mint & Note</span>
              </button>
            </div>

            {/* Quick helper preset bar */}
            <div className="invoice-preset-bar">
              <span>
                Current Network: <b>{chainId === 421614 ? 'Arbitrum Sepolia' : `Chain ${chainId ?? 'Unknown'}`}</b>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="secondary-button preset-btn" onClick={() => handleLoadSample(3)}>
                  Sample INV-003
                </button>
                <button type="button" className="secondary-button preset-btn" onClick={handleResumeRequest2}>
                  Resume Req #2
                </button>
              </div>
            </div>

            {/* Step 1: Evidence API */}
            {currentStep === 1 && (
              <div>
                <div className="eyebrow">STEP 1: INVOICE SUBMISSION</div>
                <h2>Submit Evidence to Mock API</h2>
                <p className="muted">
                  The invoice metadata and supporting evidence are canonicalized and registered with the
                  evidence provider before on-chain submission.
                </p>

                <div className="note-field">
                  <label htmlFor="invoiceId">Invoice Identifier</label>
                  <div className="input-field">
                    <input
                      id="invoiceId"
                      value={invoiceId}
                      onChange={(e) => setInvoiceId(e.target.value)}
                      placeholder="e.g. INV-003"
                    />
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="debtor">
                    Debtor Address <span className="field-sub">The enterprise client responsible for invoice payment.</span>
                  </label>
                  <div className="input-field">
                    <input
                      id="debtor"
                      value={debtor}
                      onChange={(e) => setDebtor(e.target.value)}
                      placeholder="0x..."
                    />
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="invAmt">
                    Invoice Face Value (USDC) <span className="field-sub">Total receivable amount in USDC.</span>
                  </label>
                  <div className="input-field">
                    <input
                      id="invAmt"
                      type="number"
                      min="100"
                      step="100"
                      value={invoiceAmountUsd}
                      onChange={(e) => setInvoiceAmountUsd(e.target.value)}
                    />
                    <span>USDC</span>
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="dueDate">Due Date</label>
                  <div className="input-field">
                    <input
                      id="dueDate"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      placeholder="YYYY-MM-DDTHH:mm:ssZ"
                    />
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="pdfHash">
                    Invoice PDF Hash (bytes32) <span className="field-sub">Cryptographic digest of invoice document.</span>
                  </label>
                  <div className="input-field">
                    <input
                      id="pdfHash"
                      value={pdfHash}
                      onChange={(e) => setPdfHash(e.target.value)}
                      placeholder="0x..."
                    />
                  </div>
                </div>

                {invoiceHash && (
                  <div className="derived-panel">
                    <label>Generated Canonical Hashes</label>
                    <div style={{ font: '11px monospace', wordBreak: 'break-all' }}>
                      <div>
                        Invoice Hash: <b>{invoiceHash}</b>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Evidence Hash: <b>{evidenceHash}</b>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  id="btn-submit-api"
                  className="primary-button full"
                  disabled={submittingApi || !address}
                  onClick={handleSubmitToApi}
                >
                  {submittingApi ? 'Submitting to Evidence API…' : 'Submit Invoice to Evidence API'} <ArrowUpRight size={14} />
                </button>
              </div>
            )}

            {/* Step 2: Request Onchain */}
            {currentStep === 2 && (
              <div>
                <div className="eyebrow">STEP 2: BORROWER REQUEST</div>
                <h2>Request On-Chain Verification</h2>
                <p className="muted">
                  The borrower broadcasts a formal verification request to the Notes contract binding the
                  evidence hash, desired loan terms, and risk policy.
                </p>

                <div className="note-field">
                  <label htmlFor="reqAmt">
                    Requested Loan Amount (USDC)
                    <span className="field-sub">
                      Policy restricts maximum borrowing to advance rate (e.g. 50% = max ${Number(invoiceAmountUsd) * 0.5}).
                    </span>
                  </label>
                  <div className="input-field">
                    <input
                      id="reqAmt"
                      type="number"
                      min="10"
                      value={requestedUsd}
                      onChange={(e) => setRequestedUsd(e.target.value)}
                    />
                    <span>USDC</span>
                  </div>
                  <small className="field-sub">
                    Borrowing ${reqAmtNum.toLocaleString()} against ${invAmtNum.toLocaleString()} invoice ({ltvRatio}% LTV)
                  </small>
                </div>

                <div className="note-field">
                  <label htmlFor="interestAmt">Interest Payment (USDC)</label>
                  <div className="input-field">
                    <input
                      id="interestAmt"
                      type="number"
                      min="1"
                      value={interestUsd}
                      onChange={(e) => setInterestUsd(e.target.value)}
                    />
                    <span>USDC</span>
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="durationDays">Loan Duration</label>
                  <div className="category-row">
                    <button
                      type="button"
                      className={!rapidDemoTerm ? 'active-chip' : ''}
                      onClick={() => {
                        setRapidDemoTerm(false)
                        setDurationDays('30')
                      }}
                    >
                      Standard (Days)
                    </button>
                    <button
                      type="button"
                      className={rapidDemoTerm ? 'active-chip' : ''}
                      onClick={() => {
                        setRapidDemoTerm(true)
                        setDurationDays('120')
                      }}
                    >
                      Rapid Demo (Seconds)
                    </button>
                  </div>
                  <div className="input-field" style={{ marginTop: 8 }}>
                    <input
                      id="durationDays"
                      type="number"
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                    />
                    <span>{rapidDemoTerm ? 'seconds' : 'days'}</span>
                  </div>
                </div>

                <div className="note-field">
                  <label htmlFor="policyHash">Policy Hash</label>
                  <div className="input-field">
                    <input
                      id="policyHash"
                      value={policyHash}
                      onChange={(e) => setPolicyHash(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  id="btn-request-onchain"
                  className="primary-button full"
                  disabled={submittingOnchain || !contracts}
                  onClick={handleRequestOnchain}
                >
                  {submittingOnchain ? 'Broadcasting on-chain…' : 'Submit Verification Request'} <ArrowUpRight size={14} />
                </button>
              </div>
            )}

            {/* Step 3: CRE Report Delivery */}
            {currentStep === 3 && (
              <div>
                <div className="eyebrow">STEP 3: CHAINLINK CRE POLICY</div>
                <h2>Deliver Verification Report</h2>
                <p className="muted">
                  Chainlink CRE reads the on-chain request, verifies evidence with the mock API, checks
                  tax registry status and credit scores, and delivers an on-chain report.
                </p>

                <div className="invoice-status-banner pending">
                  <ShieldCheck size={24} />
                  <div className="status-banner-content">
                    <b>Awaiting CRE Consensus Report</b>
                    <small>
                      Request ID: #{requestId || 'Pending'} • Invoice Hash: {shortHash(invoiceHash || '')}
                    </small>
                  </div>
                </div>

                <div className="derived-panel">
                  <label>Automated CRE Policy Checks</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, marginTop: 8 }}>
                    <div>
                      Tax Registry: <b style={{ color: 'var(--green)' }}>ACTIVE</b>
                    </div>
                    <div>
                      Debtor Confirmation: <b style={{ color: 'var(--green)' }}>CONFIRMED</b>
                    </div>
                    <div>
                      Credit Bureau Risk: <b style={{ color: 'var(--green)' }}>32 / 100 (PASS)</b>
                    </div>
                    <div>
                      Currency: <b style={{ color: 'var(--green)' }}>USDC</b>
                    </div>
                  </div>
                  <small style={{ marginTop: 10, display: 'block' }}>
                    Policy threshold requires Risk Score ≤ 35 to qualify for up to 70% advance rate.
                  </small>
                </div>

                <button
                  type="button"
                  id="btn-deliver-report"
                  className="primary-button full"
                  disabled={deliveringReport}
                  onClick={() => handleDeliverCreReport()}
                >
                  {deliveringReport ? 'Executing Chainlink CRE Workflow…' : 'Trigger Chainlink CRE Consensus Report'}{' '}
                  <ShieldCheck size={14} />
                </button>

                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <small className="muted">
                    Broadcasts via Chainlink CRE simulator (<code>:2000/trigger</code>) through Keystone Forwarder to Notes contract.
                  </small>
                </div>
              </div>
            )}

            {/* Step 4: Mint & Note Creation */}
            {currentStep === 4 && (
              <div>
                <div className="eyebrow">STEP 4: COLLATERAL LOAN CREATION</div>
                <h2>Create Note & Mint Invoice NFT</h2>
                <p className="muted">
                  With verified off-chain collateral on-chain, the borrower executes note creation. The
                  Notes contract mints the Invoice NFT into custody and creates the policy loan.
                </p>

                {activeCollateral?.verified ? (
                  <div className="invoice-status-banner approved">
                    <ShieldCheck size={24} />
                    <div className="status-banner-content">
                      <b>Collateral Verified On-Chain!</b>
                      <small>
                        Advance Rate: {(activeCollateral.advanceRateBps / 100).toFixed(0)}% • Face Value:{' '}
                        {fmtUsdc(activeCollateral.invoiceAmount)} • Debtor: {shortAddr(activeCollateral.debtor)}
                      </small>
                    </div>
                  </div>
                ) : (
                  <div className="invoice-status-banner">
                    <ShieldCheck size={24} />
                    <div className="status-banner-content">
                      <b>Invoice Ready for Note Creation</b>
                      <small>Terms match verified request #{requestId}</small>
                    </div>
                  </div>
                )}

                <div className="note-field">
                  <label htmlFor="pdfUriField">Invoice Document URI (NFT Metadata)</label>
                  <div className="input-field">
                    <input
                      id="pdfUriField"
                      value={pdfUri}
                      onChange={(e) => setPdfUri(e.target.value)}
                    />
                  </div>
                </div>

                <div className="derived-panel">
                  <label>Loan Terms Summary</label>
                  <div className="interest-grid">
                    <div>
                      <small>Requested Borrow</small>
                      <b>${reqAmtNum.toLocaleString()} USDC</b>
                    </div>
                    <div>
                      <small>Interest</small>
                      <b>${intAmtNum.toLocaleString()} USDC</b>
                    </div>
                    <div>
                      <small>Duration</small>
                      <b>{durationDays} {rapidDemoTerm ? 'seconds' : 'days'}</b>
                    </div>
                    <div>
                      <small>Collateral Kind</small>
                      <b>INVOICE NFT</b>
                    </div>
                  </div>
                </div>

                {noteId ? (
                  <div className="note-success" style={{ padding: '20px 0' }}>
                    <div className="success-mark">
                      <Check size={28} />
                    </div>
                    <h2>Invoice Note #{noteId} Created!</h2>
                    <p className="muted">
                      Your note backed by Invoice NFT collateral is ready to be funded by vault mandates.
                    </p>
                    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                      <button
                        type="button"
                        className="primary-button full"
                        onClick={() => router.push(`/simulator?noteId=${noteId}`)}
                      >
                        Fund in Simulator <ArrowUpRight size={14} />
                      </button>
                      <button
                        type="button"
                        className="secondary-button full"
                        onClick={() => setActiveTab('nfts')}
                      >
                        View Minted NFT <Sparkles size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    id="btn-create-invoice-note"
                    className="primary-button full"
                    disabled={creatingNote || !contracts}
                    onClick={handleCreateNoteWithInvoice}
                  >
                    {creatingNote ? 'Minting NFT & Creating Note…' : 'Create Note with Invoice Collateral'}{' '}
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Right: Live NFT Preview Illustration */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              COLLATERAL PREVIEW
            </div>
            <InvoiceNftCard
              metadata={{
                tokenId: 1n,
                invoiceHash:
                  invoiceHash ||
                  '0xa50d5c33ec756cf20e7cd9d93b615e8cf2b21a8f8e21a6636722bf696e2bfbd2',
                invoiceAmount:
                  BigInt(Math.floor(Number(invoiceAmountUsd) || 35000)) * 1_000_000n,
                advanceRateBps: 5000,
                riskScore: 32,
                debtor: debtor || DEFAULT_DEBTOR,
                dueDate: BigInt(Math.floor(Date.parse(dueDate) / 1000)),
                verifiedAt: BigInt(Math.floor(Date.now() / 1000)),
                pdfUri: pdfUri || DEFAULT_PDF_URI,
                owner: contracts?.addresses?.notes || '0x84d6...32b',
              }}
              linkedNoteId={noteId}
            />

            <div
              style={{
                marginTop: 16,
                padding: 14,
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontSize: 11,
                color: 'var(--muted)',
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
                <Lock size={13} color="var(--violet)" /> Notes Custody Enforceability
              </div>
              Minting tokenizes the receivable as a Confluence Invoice NFT (cINV). The Notes contract
              retains custody of the token until the loan is marked repaid by the debtor or settlement router.
            </div>
          </div>
        </div>
      )}

      {/* Tab: Minted NFTs Portfolio */}
      {activeTab === 'nfts' && (
        <div>
          <div className="notes-hero" style={{ marginBottom: 20 }}>
            <div>
              <span className="eyebrow">Tokenized Collateral Registry</span>
              <h2>Minted Invoice NFTs</h2>
              <p>
                All on-chain invoice NFTs minted and held under protocol custody on Arbitrum Sepolia.
              </p>
            </div>
            <button className="secondary-button" onClick={() => refetchNfts()}>
              <RefreshCw size={13} /> Refresh List
            </button>
          </div>

          {allNfts.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
              {allNfts.map((nft) => (
                <InvoiceNftCard key={nft.tokenId.toString()} metadata={nft} />
              ))}
            </div>
          ) : (
            <div className="notes-empty" style={{ padding: 40 }}>
              <Sparkles size={32} />
              <h3>No Invoice NFTs Minted Yet</h3>
              <p className="muted" style={{ maxWidth: 400, textAlign: 'center', marginBottom: 16 }}>
                Submit an invoice and create a note to mint the first tokenized receivable into custody.
              </p>
              <button className="primary-button" onClick={() => setActiveTab('flow')}>
                Start Invoice Financing Flow <ArrowUpRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: System & Architecture Info */}
      {activeTab === 'info' && (
        <div style={{ maxWidth: 800 }}>
          <div className="create-note-form" style={{ width: '100%' }}>
            <div className="eyebrow">ARCHITECTURE & SYSTEM OVERVIEW</div>
            <h2>Chainlink CRE + Notes Protocol Workflow</h2>

            <div className="contract-sentence" style={{ marginTop: 14 }}>
              <b>1. Off-Chain Evidence Submission</b>: The invoice is registered with the evidence service
              (or tax authority endpoint). Produces canonical <code>invoiceHash</code> and <code>evidenceHash</code>.
            </div>

            <div className="contract-sentence">
              <b>2. On-Chain Verification Request</b>: The borrower calls{' '}
              <code>Notes.requestInvoiceVerification(...)</code>. Emits an event with request parameters.
            </div>

            <div className="contract-sentence">
              <b>3. CRE Consensus Report</b>: The Chainlink CRE workflow reads the request, fetches the
              evidence, evaluates deterministic credit policies, and broadcasts <code>onReport(...)</code> via
              the forwarder.
            </div>

            <div className="contract-sentence">
              <b>4. Custodial NFT Minting & Note Activation</b>: The borrower executes{' '}
              <code>createNoteWithInvoice(...)</code>. The Notes contract mints the <code>InvoiceNFT</code>{' '}
              into custody, ensuring the loan is over-collateralized by a verified enterprise receivable.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
