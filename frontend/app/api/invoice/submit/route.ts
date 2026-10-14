import { NextResponse } from 'next/server'
import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from 'ethers'

const INVOICE_API_URL = process.env.INVOICE_API_URL || 'http://localhost:8787'

const coder = AbiCoder.defaultAbiCoder()

function canonicalize(v: any) {
  return {
    invoiceId: String(v.invoiceId || '').trim(),
    issuer: getAddress(v.issuer),
    debtor: getAddress(v.debtor),
    amount: String(v.amount),
    dueDate: String(Math.floor(Date.parse(v.dueDate) / 1000)),
    invoicePdfHash: String(v.invoicePdfHash || '').toLowerCase(),
    borrowerAddress: getAddress(v.borrowerAddress),
    currency: String(v.currency || 'USDC').toUpperCase(),
  }
}

function invoiceHashOf(v: ReturnType<typeof canonicalize>) {
  return keccak256(
    coder.encode(
      [
        'string',
        'address',
        'address',
        'uint256',
        'uint64',
        'bytes32',
        'address',
        'string',
      ],
      [
        v.invoiceId,
        v.issuer,
        v.debtor,
        v.amount,
        v.dueDate,
        v.invoicePdfHash,
        v.borrowerAddress,
        v.currency,
      ]
    )
  )
}

function evidenceHashOf(v: ReturnType<typeof canonicalize>) {
  return keccak256(toUtf8Bytes(JSON.stringify(v)))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // 1. Try sending to the running invoice-api service
    try {
      const res = await fetch(`${INVOICE_API_URL.replace(/\/$/, '')}/invoice/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      })

      if (res.ok) {
        const data = await res.json()
        return NextResponse.json({
          ok: true,
          ...data,
          source: 'invoice-api',
        })
      }
    } catch (apiErr) {
      console.warn('Direct invoice-api unreachable, fallback to local compute:', apiErr)
    }

    // 2. Local deterministic fallback computation
    const canonical = canonicalize(body)
    const invoiceHash = invoiceHashOf(canonical)
    const evidenceHash = evidenceHashOf(canonical)

    return NextResponse.json({
      ok: true,
      invoiceHash,
      evidenceHash,
      canonical,
      source: 'local-fallback',
      next: 'Call Notes.requestInvoiceVerification(invoiceHash,evidenceHash,policyHash,purposeHash,requested,interest,duration) from borrowerAddress.',
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Invoice submission failed' },
      { status: 400 }
    )
  }
}
