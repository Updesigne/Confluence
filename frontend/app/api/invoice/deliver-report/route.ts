import { NextResponse } from 'next/server'
import { AbiCoder, Contract, JsonRpcProvider, keccak256 } from 'ethers'
import { ADDRESSES } from '@/lib/web3/addresses'

const RPC_URL = process.env.RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'
const NOTES_ADDRESS =
  (process.env.NOTES_ADDRESS as `0x${string}`) ||
  ADDRESSES[421614]?.notes ||
  '0x9A22C47A8A6D444c78267f003f6154Cd23244D5B'

const CRE_TRIGGER_URL =
  process.env.CRE_TRIGGER_URL ||
  process.env.CRE_TRIGGER_PROXY_URL ||
  'http://localhost:2000/trigger'

const CRE_WORKFLOW_ID =
  process.env.CRE_WORKFLOW_ID ||
  'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890'

const NOTES_ABI = [
  'function invoiceRequests(uint256) view returns (uint256 id, address borrower, bytes32 invoiceHash, bytes32 evidenceHash, bytes32 policyHash, bytes32 purposeHash, uint256 requested, uint256 interest, uint256 duration, uint256 createdAt, bool processed, bool approved)',
  'function offChainCollaterals(bytes32) view returns (bytes32 invoiceHash, uint256 invoiceAmount, uint256 riskScore, uint256 advanceRateBps, address debtor, bool verified, uint256 verifiedAt, bool financed)',
]

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { requestId: reqIdParam, invoiceHash: invHashParam } = body

    if (!reqIdParam && !invHashParam) {
      return NextResponse.json(
        { ok: false, error: 'Missing requestId or invoiceHash' },
        { status: 400 }
      )
    }

    const provider = new JsonRpcProvider(RPC_URL)
    const notes = new Contract(NOTES_ADDRESS, NOTES_ABI, provider)

    const requestId = BigInt(reqIdParam)
    const request = await notes.invoiceRequests(requestId)

    if (BigInt(request.id) !== requestId || requestId === 0n) {
      return NextResponse.json(
        { ok: false, error: `Request #${requestId} does not exist on-chain` },
        { status: 404 }
      )
    }

    // 1. If already processed on-chain by Chainlink CRE, return result immediately
    if (request.processed) {
      const oc = await notes.offChainCollaterals(request.invoiceHash)
      return NextResponse.json({
        ok: true,
        alreadyProcessed: true,
        source: 'chainlink-cre',
        approved: request.approved,
        requestId: requestId.toString(),
        invoiceHash: request.invoiceHash,
        offChainCollateral: {
          verified: oc.verified,
          riskScore: Number(oc.riskScore),
          advanceRateBps: Number(oc.advanceRateBps),
          invoiceAmount: oc.invoiceAmount.toString(),
          debtor: oc.debtor,
          financed: oc.financed,
        },
      })
    }

    // 2. Compute canonical reportNonce from on-chain request (exact match with 05-request-invoice-verification.ts)
    const reportNonce = BigInt(
      keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'bytes32', 'uint256'],
          [requestId, request.evidenceHash, request.createdAt]
        )
      )
    ).toString()

    // Persist invoice-request.json so CLI tools (06-create-approved-invoice-note.ts) stay in sync
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const scriptReqPath = path.resolve(process.cwd(), '..', 'cre-kit', 'scripts', 'invoice-request.json')
      const localReqPath = path.resolve(process.cwd(), 'invoice-request.json')
      const reqState = {
        chainId: '421614',
        notes: NOTES_ADDRESS,
        requestId: requestId.toString(),
        invoiceHash: request.invoiceHash,
        evidenceHash: request.evidenceHash,
        policyHash: request.policyHash,
        purposeHash: request.purposeHash,
        requested: request.requested.toString(),
        interest: request.interest.toString(),
        duration: request.duration.toString(),
        borrower: request.borrower,
        createdAt: request.createdAt.toString(),
        reportNonce,
      }
      if (fs.existsSync(path.dirname(scriptReqPath))) {
        fs.writeFileSync(scriptReqPath, JSON.stringify(reqState, null, 2))
      }
      fs.writeFileSync(localReqPath, JSON.stringify(reqState, null, 2))
    } catch {}

    // 3. Trigger Chainlink CRE workflow simulator listening on port 2000
    const triggerUrl = new URL(CRE_TRIGGER_URL)
    triggerUrl.searchParams.set('workflowID', CRE_WORKFLOW_ID)

    const triggerInput = {
      requestId: requestId.toString(),
      invoiceHash: request.invoiceHash,
      evidenceHash: request.evidenceHash,
      borrower: request.borrower,
      policyHash: request.policyHash,
      reportNonce,
    }

    let triggerAccepted = false
    let triggerErr = ''

    try {
      const triggerRes = await fetch(triggerUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: triggerInput }),
        signal: AbortSignal.timeout(8000),
      })

      if (triggerRes.ok) {
        triggerAccepted = true
      } else {
        triggerErr = `HTTP ${triggerRes.status}: ${await triggerRes.text()}`
      }
    } catch (err: any) {
      triggerErr = err?.message || 'Connection refused on port 2000'
    }

    if (!triggerAccepted) {
      return NextResponse.json(
        {
          ok: false,
          error: `Chainlink CRE Simulator trigger failed on ${CRE_TRIGGER_URL}. Make sure it is running: 'cre workflow simulate ./notes --listen --broadcast --target staging-settings'. (${triggerErr})`,
        },
        { status: 502 }
      )
    }

    // 4. Poll Arbitrum Sepolia for Chainlink CRE on-chain report write confirmation
    // Arbitrum Sepolia confirms transactions in ~2-4s. We poll every 1.5s for up to ~25s.
    const maxPollAttempts = 15
    let confirmedRequest = null
    let confirmedCollateral = null

    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1500))

      try {
        const polled = await notes.invoiceRequests(requestId)
        if (polled.processed) {
          confirmedRequest = polled
          confirmedCollateral = await notes.offChainCollaterals(request.invoiceHash)
          break
        }
      } catch {}
    }

    if (!confirmedRequest || !confirmedRequest.processed) {
      return NextResponse.json({
        ok: true,
        pending: true,
        source: 'chainlink-cre',
        message:
          'Chainlink CRE workflow triggered successfully! Transaction was broadcasted to Arbitrum Sepolia and is confirming.',
        requestId: requestId.toString(),
        invoiceHash: request.invoiceHash,
      })
    }

    return NextResponse.json({
      ok: true,
      source: 'chainlink-cre',
      approved: confirmedRequest.approved,
      requestId: requestId.toString(),
      invoiceHash: request.invoiceHash,
      offChainCollateral: confirmedCollateral
        ? {
            verified: confirmedCollateral.verified,
            riskScore: Number(confirmedCollateral.riskScore),
            advanceRateBps: Number(confirmedCollateral.advanceRateBps),
            invoiceAmount: confirmedCollateral.invoiceAmount.toString(),
            debtor: confirmedCollateral.debtor,
            financed: confirmedCollateral.financed,
          }
        : null,
    })
  } catch (err: any) {
    console.error('CRE deliver-report error:', err)
    return NextResponse.json(
      { ok: false, error: err?.reason || err?.message || 'Failed to trigger Chainlink CRE' },
      { status: 500 }
    )
  }
}
