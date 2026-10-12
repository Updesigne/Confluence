import { formatUnits, parseUnits } from 'ethers'

export const USDC_DECIMALS = 6
export const WETH_DECIMALS = 18

export function fmtUsdc(v: bigint, decimals = USDC_DECIMALS): string {
  const n = Number(formatUnits(v, decimals))
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

export function parseUsdc(v: string | number): bigint {
  return parseUnits(String(v), USDC_DECIMALS)
}

export function fmtWeth(v: bigint): string {
  return `${Number(formatUnits(v, WETH_DECIMALS)).toFixed(4)} WETH`
}

export function parseWeth(v: string | number): bigint {
  return parseUnits(String(v), WETH_DECIMALS)
}

export function shortAddr(a?: string): string {
  if (!a) return ''
  return `${a.slice(0, 4)}…${a.slice(-4)}`
}

export function shortHash(h?: string): string {
  if (!h) return ''
  return `${h.slice(0, 6)}…${h.slice(-4)}`
}

export function bpsToPct(bps: bigint | number): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps
  return `${(n / 100).toFixed(2)}%`
}

export function secondsToDays(s: bigint | number): number {
  const n = typeof s === 'bigint' ? Number(s) : s
  return Math.floor(n / 86400)
}

export function tsToDate(ts: bigint | number): string {
  const n = typeof ts === 'bigint' ? Number(ts) : ts
  if (!n) return '—'
  return new Date(n * 1000).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}