'use client'
import { useQuery } from '@tanstack/react-query'
import { Contract } from 'ethers'
import type { TransactionReceipt } from 'ethers'
import { useWeb3 } from '@/providers/Web3Provider'
import { ERC20_ABI } from '@/lib/web3/abis'
import type { useTxTracker } from '@/hooks/useTxTracker'

type TrackTransaction = ReturnType<typeof useTxTracker>['track']

export type VaultAccount = {
  id: bigint
  owner: string
  available: bigint
  committed: bigint
  deployed: bigint
  collateralized: bigint
  active: boolean
}

export function useVaultAccounts() {
  const { address, contracts } = useWeb3()
  return useQuery({
    queryKey: ['vault', 'accounts', address],
    enabled: !!contracts && !!address,
    queryFn: async (): Promise<VaultAccount[]> => {
      const ids = (await contracts!.vault.accountsOf(address!)) as bigint[]
      return Promise.all(
        ids.map(async (id) => {
          const a = await contracts!.vault.account(id)
          return {
            id,
            owner: a[0],
            available: a[1],
            committed: a[2],
            deployed: a[3],
            collateralized: a[4],
            active: a[5],
          }
        })
      )
    },
  })
}

export function useVaultTotals() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['vault', 'totals'],
    enabled: !!contracts,
    queryFn: async () => {
      const [l, c, e] = await Promise.all([
        contracts!.vault.totalLiabilities(),
        contracts!.vault.totalCommitted(),
        contracts!.vault.externalBacking(),
      ])
      return { liabilities: l as bigint, committed: c as bigint, external: e as bigint }
    },
  })
}

export function useUsdcBalance() {
  const { address, contracts } = useWeb3()
  return useQuery({
    queryKey: ['usdg', 'balance', address],
    enabled: !!contracts && !!address,
    queryFn: async () => (await contracts!.usdg.balanceOf(address!)) as bigint,
  })
}

export const useUsdgBalance = useUsdcBalance

export function useCreateVaultAccount() {
  const { contracts } = useWeb3()
  return async () => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.vault.createAccount()
    return tx.wait()
  }
}

export function useDeposit() {
  const { contracts, signer } = useWeb3()
  return async (accountId: bigint, amount: bigint, track?: TrackTransaction) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const vaultAddr = await contracts.vault.getAddress()
    const signerAddr = await signer.getAddress()
    const allowance = (await contracts.usdg.allowance(signerAddr, vaultAddr)) as bigint
    if (allowance < amount) {
      const approve = async () => {
        const tx = await contracts.usdg.approve(vaultAddr, amount)
        return tx.wait()
      }
      if (track) await track(`vault.approveDeposit #${accountId}`, approve)
      else await approve()
    }
    const deposit = async () => {
      const tx = await contracts.vault.deposit(accountId, amount)
      return tx.wait()
    }
    return track ? track(`vault.deposit #${accountId}`, deposit) : deposit()
  }
}

export function useWithdraw() {
  const { contracts } = useWeb3()
  return async (accountId: bigint, amount: bigint) => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.vault.withdraw(accountId, amount)
    return tx.wait()
  }
}

/** Mint mock USDG to the caller — testnet faucet. */
export function useMintUsdg() {
  const { address, signer, contracts } = useWeb3()
  const { refetch: refetchBalance } = useUsdgBalance()

  return async (to?: string, amount?: number | string | bigint) => {
    const targetAddress = to || address
    if (!targetAddress) throw new Error('Connect wallet first')

    // 1. Attempt via the reliable faucet API (owner-signed on Arbitrum Sepolia)
    try {
      const numAmt = typeof amount === 'bigint' ? Number(amount) / 1e6 : amount || 10000
      const res = await fetch('/api/faucet/usdg', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: targetAddress, amount: numAmt }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        await refetchBalance?.()
        return data
      }
      throw new Error(data.error || 'Faucet request failed')
    } catch (apiErr: any) {
      // 2. Fallback to direct client-side signer call
      if (contracts && signer) {
        const usdg = new Contract(
          contracts.addresses.usdg,
          ['function mint(address,uint256)'],
          signer
        )
        const amtUnits = typeof amount === 'bigint'
          ? amount
          : BigInt(Math.floor((Number(amount) || 10000) * 1_000_000))
        const tx = await usdg.mint(targetAddress, amtUnits)
        const receipt = await tx.wait()
        await refetchBalance?.()
        return { ok: true, txHash: tx.hash, blockNumber: receipt?.blockNumber }
      }
      throw apiErr
    }
  }
}

/** Mint mock USDC / USDG — backwards-compatible alias */
export const useMintUsdc = useMintUsdg