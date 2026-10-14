import { NextResponse } from 'next/server'

const INVOICE_API_URL = process.env.INVOICE_API_URL || 'http://localhost:8787'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invoiceHash: string }> }
) {
  try {
    const { invoiceHash } = await params
    const res = await fetch(
      `${INVOICE_API_URL.replace(/\/$/, '')}/invoice/${invoiceHash}/evidence`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'Evidence not found' },
        { status: res.status }
      )
    }
    const data = await res.json()
    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Evidence request failed' },
      { status: 500 }
    )
  }
}
