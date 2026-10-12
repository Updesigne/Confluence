'use client'
import { useQuery } from '@tanstack/react-query'
import { Contract } from 'ethers'
import { useWeb3 } from '@/providers/Web3Provider'
import { ERC20_ABI } from '@/lib/web3/abis'

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
    queryKey: ['usdc', 'balance', address],
    enabled: !!contracts && !!address,
    queryFn: async () => (await contracts!.usdc.balanceOf(address!)) as bigint,
  })
}

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
  return async (accountId: bigint, amount: bigint) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const vaultAddr = await contracts.vault.getAddress()
    const signerAddr = await signer.getAddress()
    const allowance = (await contracts.usdc.allowance(signerAddr, vaultAddr)) as bigint
    if (allowance < amount) {
      const t = await contracts.usdc.approve(vaultAddr, amount)
      await t.wait()
    }
    const tx = await contracts.vault.deposit(accountId, amount)
    return tx.wait()
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

/** Mint mock USDC — testnet only. */
export function useMintUsdc() {
  const { signer, contracts } = useWeb3()
  return async (to: string, amount: bigint) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const usdc = new Contract(
      contracts.addresses.usdc,
      ['function mint(address,uint256)'],
      signer
    )
    const tx = await usdc.mint(to, amount)
    return tx.wait()
  }
}