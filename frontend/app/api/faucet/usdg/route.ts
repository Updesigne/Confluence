import { NextResponse } from 'next/server'
import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers'
import { ADDRESSES } from '@/lib/web3/addresses'

const RPC_URL = process.env.RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'
const USDG_ADDRESS =
  (process.env.USDG_ADDRESS as `0x${string}`) ||
  ADDRESSES[421614]?.usdg ||
  '0x3BfcBCE79FAb56B3400CB909C2B65CA00732a43B'

const PRIVATE_KEY =
  process.env.PRIVATE_KEY ||
  '14ffbcece3277e23d984fa48a35a5b8646e92528b59bff9a25e1c501ba4800b5'

const USDG_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function owner() external view returns (address)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
]

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const { to, amount } = body

    if (!to || !isAddress(to)) {
      return NextResponse.json(
        { ok: false, error: 'Valid recipient Ethereum address "to" is required' },
        { status: 400 }
      )
    }

    // Default amount: 10,000 mUSDG (6 decimals = 10,000 * 10^6 = 10_000_000_000)
    let amountUnits: bigint
    if (amount) {
      const cleanAmt = String(amount).replace(/,/g, '').trim()
      const parsedFloat = parseFloat(cleanAmt)
      if (isNaN(parsedFloat) || parsedFloat <= 0) {
        return NextResponse.json(
          { ok: false, error: 'Invalid mint amount specified' },
          { status: 400 }
        )
      }
      amountUnits = BigInt(Math.floor(parsedFloat * 1_000_000))
    } else {
      amountUnits = 10_000_000_000n // 10,000 USDG
    }

    const provider = new JsonRpcProvider(RPC_URL)
    const signer = new Wallet(PRIVATE_KEY, provider)
    const usdg = new Contract(USDG_ADDRESS, USDG_ABI, signer)

    // Mint tokens directly to the caller on-chain
    const tx = await usdg.mint(to, amountUnits)
    const receipt = await tx.wait()

    const newBalance = (await usdg.balanceOf(to)) as bigint

    return NextResponse.json({
      ok: true,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      to,
      amountMinted: amountUnits.toString(),
      formattedAmount: `${(Number(amountUnits) / 1e6).toLocaleString()} mUSDG`,
      balance: newBalance.toString(),
      formattedBalance: `${(Number(newBalance) / 1e6).toLocaleString()} mUSDG`,
    })
  } catch (err: any) {
    console.error('Faucet USDG mint error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: err?.reason || err?.message || 'Failed to mint mock USDG',
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const address = searchParams.get('address')

    const provider = new JsonRpcProvider(RPC_URL)
    const usdg = new Contract(USDG_ADDRESS, USDG_ABI, provider)

    if (address && isAddress(address)) {
      const balance = (await usdg.balanceOf(address)) as bigint
      return NextResponse.json({
        ok: true,
        address,
        balance: balance.toString(),
        formatted: `${(Number(balance) / 1e6).toLocaleString()} mUSDG`,
      })
    }

    return NextResponse.json({
      ok: true,
      usdgAddress: USDG_ADDRESS,
      faucetAvailable: true,
      defaultMintAmount: '10,000 mUSDG',
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error querying faucet' },
      { status: 500 }
    )
  }
}
