'use client'
import { useQuery } from '@tanstack/react-query'
import { Contract, formatUnits } from 'ethers'
import type { TransactionReceipt } from 'ethers'
import { useWeb3 } from '@/providers/Web3Provider'
import { ERC20_ABI } from '@/lib/web3/abis'

export type Note = {
  id: bigint
  borrower: string
  requested: bigint
  funded: bigint
  collateralAmount: bigint
  interest: bigint
  duration: bigint
  maturity: bigint
  settlementCutoff: bigint
  repaidAmount: bigint
  purposeHash: string
  policyHash: string
  status: number // 0 OPEN, 1 FUNDED, 2 REPAID, 3 DEFAULTED, 4 LIQUIDATED, 5 CANCELLED
  collateralKind: number // 0 NONE, 1 WETH, 2 INVOICE
  invoiceTokenId: bigint
  invoiceHash: string
}

function map(raw: any): Note {
  return {
    id: raw.id ?? raw[0],
    borrower: raw.borrower ?? raw[1],
    requested: raw.requested ?? raw[2],
    funded: raw.funded ?? raw[3],
    collateralAmount: raw.collateralAmount ?? raw[4],
    interest: raw.interest ?? raw[5],
    duration: raw.duration ?? raw[6],
    maturity: raw.maturity ?? raw[7],
    settlementCutoff: raw.settlementCutoff ?? raw[8],
    repaidAmount: raw.repaidAmount ?? raw[9],
    purposeHash: raw.purposeHash ?? raw[10],
    policyHash: raw.policyHash ?? raw[11],
    status: Number(raw.status ?? raw[12]),
    collateralKind: Number(raw.collateralKind ?? raw[13] ?? 1),
    invoiceTokenId: BigInt(raw.invoiceTokenId ?? raw[14] ?? 0),
    invoiceHash: String(raw.invoiceHash ?? raw[15] ?? ''),
  }
}

export function useNotes() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['notes'],
    enabled: !!contracts,
    queryFn: async (): Promise<Note[]> => {
      const next = (await contracts!.notes.nextNoteId()) as bigint
      const ids: bigint[] = []
      for (let i = 1n; i < next; i++) ids.push(i)
      const rows = await Promise.all(ids.map((i) => contracts!.notes.getNote(i)))
      return rows.map(map)
    },
  })
}

export function useEthPrice() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['notes', 'ethPrice'],
    enabled: !!contracts,
    queryFn: async () => (await contracts!.notes.currentEthPriceUsd()) as bigint,
    refetchInterval: 60_000,
  })
}

export function useWethBalance() {
  const { address, contracts } = useWeb3()
  return useQuery({
    queryKey: ['weth', 'balance', address],
    enabled: !!contracts && !!address,
    queryFn: async () => (await contracts!.weth.balanceOf(address!)) as bigint,
    refetchInterval: 15_000,
  })
}

export function useMintWeth() {
  const { signer, contracts } = useWeb3()
  return async (to: string, amount: bigint) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const weth = new Contract(
      contracts.addresses.weth,
      ['function mint(address,uint256)'],
      signer
    )
    const tx = await weth.mint(to, amount)
    return tx.wait()
  }
}

export type CreateNoteInput = {
  requested: bigint
  collateralAmount: bigint
  interest: bigint
  duration: bigint
  purposeHash?: string
  policyHash?: string
}

const ZERO32 = '0x' + '00'.repeat(32)
type TrackTransaction = (
  label: string,
  send: () => Promise<TransactionReceipt | null>
) => Promise<TransactionReceipt | null>

export function useCreateNote() {
  const { contracts, signer } = useWeb3()
  return async (input: CreateNoteInput, track?: TrackTransaction) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const userAddr = await signer.getAddress()
    const notesAddr = await contracts.notes.getAddress()

    // 1. Ensure user has enough WETH collateral (auto-mint on testnet if needed)
    try {
      const balance = (await contracts.weth.balanceOf(userAddr)) as bigint
      if (balance < input.collateralAmount) {
        const missing = input.collateralAmount - balance
        const wethToken = new Contract(
          contracts.addresses.weth,
          ['function mint(address,uint256)'],
          signer
        )
        const mintTx = async () => {
          const tx = await wethToken.mint(userAddr, missing)
          return tx.wait()
        }
        if (track) await track('weth.mintCollateral', mintTx)
        else await mintTx()
      }
    } catch (mintErr) {
      console.warn('WETH mint skipped or not permitted:', mintErr)
    }

    // 2. Approve WETH collateral to Notes contract if needed
    const allowance = (await contracts.weth.allowance(
      userAddr,
      notesAddr
    )) as bigint
    if (allowance < input.collateralAmount) {
      const approve = async () => {
        const tx = await contracts.weth.approve(notesAddr, input.collateralAmount)
        return tx.wait()
      }
      if (track) await track('notes.approveCollateral', approve)
      else await approve()
    }

    // 3. Call smart contract and broadcast createNote transaction
    const create = async () => {
      const tx = await contracts.notes.createNote(
        input.requested,
        input.collateralAmount,
        input.interest,
        input.duration,
        input.purposeHash ?? ZERO32,
        input.policyHash ?? ZERO32
      )
      return tx.wait()
    }
    return track ? track('notes.createNote', create) : create()
  }
}

export function useDepositRepayment() {
  const { contracts, signer } = useWeb3()
  return async (noteId: bigint, track?: TrackTransaction) => {
    if (!contracts || !signer) throw new Error('Not connected')
    const assetAddress = await contracts.notes.asset() as string
    const asset = new Contract(assetAddress, ERC20_ABI, signer)
    const borrower = await signer.getAddress()
    const owed = await contracts.notes.notes(noteId) as readonly unknown[]
    const requested = owed[2] as bigint
    const interest = owed[5] as bigint
    const repayment = requested + interest
    const allowance = await asset.allowance(borrower, await contracts.notes.getAddress()) as bigint
    if (allowance < repayment) {
      const approve = async () => {
        const approval = await asset.approve(await contracts.notes.getAddress(), repayment)
        return approval.wait()
      }
      if (track) await track(`notes.approveRepayment #${noteId}`, approve)
      else await approve()
    }
    const deposit = async () => {
      const tx = await contracts.notes.depositRepayment(noteId)
      return tx.wait()
    }
    return track ? track(`notes.depositRepayment #${noteId}`, deposit) : deposit()
  }
}

export function useWithdrawNoteCollateral() {
  const { contracts } = useWeb3()
  return async (noteId: bigint) => {
    if (!contracts) throw new Error('Not connected')
    const tx = await contracts.notes.withdrawCollateral(noteId)
    return tx.wait()
  }
}

export type OffChainCollateral = {
  invoiceHash: string
  invoiceAmount: bigint
  riskScore: number
  advanceRateBps: number
  debtor: string
  verified: boolean
  verifiedAt: bigint
  financed: boolean
}

export function useOffChainCollateral(invoiceHash?: string | null) {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['offChainCollateral', invoiceHash],
    enabled: !!contracts && !!invoiceHash && invoiceHash.startsWith('0x'),
    queryFn: async (): Promise<OffChainCollateral | null> => {
      try {
        const raw = await contracts!.notes.offChainCollaterals(invoiceHash)
        return {
          invoiceHash: raw[0],
          invoiceAmount: raw[1] as bigint,
          riskScore: Number(raw[2]),
          advanceRateBps: Number(raw[3]),
          debtor: raw[4] as string,
          verified: Boolean(raw[5]),
          verifiedAt: raw[6] as bigint,
          financed: Boolean(raw[7]),
        }
      } catch {
        return null
      }
    },
    refetchInterval: 5_000,
  })
}

export type OnChainInvoiceRequest = {
  id: bigint
  borrower: string
  invoiceHash: string
  evidenceHash: string
  policyHash: string
  purposeHash: string
  requested: bigint
  interest: bigint
  duration: bigint
  createdAt: bigint
  processed: boolean
  approved: boolean
}

export function useInvoiceRequest(requestId?: bigint | string | null) {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['invoiceRequest', String(requestId)],
    enabled: !!contracts && !!requestId && BigInt(requestId) > 0n,
    queryFn: async (): Promise<OnChainInvoiceRequest | null> => {
      try {
        const raw = await contracts!.notes.invoiceRequests(BigInt(requestId!))
        return {
          id: raw[0] as bigint,
          borrower: raw[1] as string,
          invoiceHash: raw[2] as string,
          evidenceHash: raw[3] as string,
          policyHash: raw[4] as string,
          purposeHash: raw[5] as string,
          requested: raw[6] as bigint,
          interest: raw[7] as bigint,
          duration: raw[8] as bigint,
          createdAt: raw[9] as bigint,
          processed: Boolean(raw[10]),
          approved: Boolean(raw[11]),
        }
      } catch {
        return null
      }
    },
    refetchInterval: 4_000,
  })
}

export type InvoiceNftMetadata = {
  tokenId: bigint
  invoiceHash: string
  invoiceAmount: bigint
  advanceRateBps: number
  riskScore: number
  debtor: string
  dueDate: bigint
  verifiedAt: bigint
  pdfUri: string
  owner: string
}

export function useInvoiceNftMetadata(tokenId?: bigint | string | number | null) {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['invoiceNft', String(tokenId)],
    enabled: !!contracts && !!tokenId && BigInt(tokenId) > 0n,
    queryFn: async (): Promise<InvoiceNftMetadata | null> => {
      try {
        const id = BigInt(tokenId!)
        const meta = await contracts!.invoiceNFT.metadata(id)
        let owner = ''
        try {
          owner = await contracts!.invoiceNFT.ownerOf(id)
        } catch {}
        return {
          tokenId: id,
          invoiceHash: meta[0],
          invoiceAmount: meta[1] as bigint,
          advanceRateBps: Number(meta[2]),
          riskScore: Number(meta[3]),
          debtor: meta[4],
          dueDate: meta[5] as bigint,
          verifiedAt: meta[6] as bigint,
          pdfUri: meta[7],
          owner,
        }
      } catch {
        return null
      }
    },
    refetchInterval: 10_000,
  })
}

export function useAllInvoiceNfts() {
  const { contracts } = useWeb3()
  return useQuery({
    queryKey: ['allInvoiceNfts'],
    enabled: !!contracts,
    queryFn: async (): Promise<InvoiceNftMetadata[]> => {
      try {
        const next = (await contracts!.invoiceNFT.nextTokenId()) as bigint
        const items: InvoiceNftMetadata[] = []
        for (let i = 1n; i < next; i++) {
          try {
            const meta = await contracts!.invoiceNFT.metadata(i)
            let owner = ''
            try {
              owner = await contracts!.invoiceNFT.ownerOf(i)
            } catch {}
            items.push({
              tokenId: i,
              invoiceHash: meta[0],
              invoiceAmount: meta[1] as bigint,
              advanceRateBps: Number(meta[2]),
              riskScore: Number(meta[3]),
              debtor: meta[4],
              dueDate: meta[5] as bigint,
              verifiedAt: meta[6] as bigint,
              pdfUri: meta[7],
              owner,
            })
          } catch {}
        }
        return items
      } catch {
        return []
      }
    },
    refetchInterval: 12_000,
  })
}

export type RequestInvoiceVerificationInput = {
  invoiceHash: string
  evidenceHash: string
  policyHash: string
  purposeHash: string
  requested: bigint
  interest: bigint
  duration: bigint
}

export function useRequestInvoiceVerification() {
  const { contracts, signer } = useWeb3()
  return async (input: RequestInvoiceVerificationInput, track?: TrackTransaction) => {
    if (!contracts || !signer) throw new Error('Wallet not connected')
    const action = async () => {
      const tx = await contracts.notes.requestInvoiceVerification(
        input.invoiceHash,
        input.evidenceHash,
        input.policyHash,
        input.purposeHash,
        input.requested,
        input.interest,
        input.duration
      )
      return tx.wait()
    }
    return track ? track('notes.requestInvoiceVerification', action) : action()
  }
}

export type CreateNoteWithInvoiceInput = {
  invoiceHash: string
  requested: bigint
  interest: bigint
  duration: bigint
  purposeHash: string
  policyHash: string
  pdfUri: string
}

export function useCreateNoteWithInvoice() {
  const { contracts, signer } = useWeb3()
  return async (input: CreateNoteWithInvoiceInput, track?: TrackTransaction) => {
    if (!contracts || !signer) throw new Error('Wallet not connected')
    const action = async () => {
      const tx = await contracts.notes.createNoteWithInvoice(
        input.invoiceHash,
        input.requested,
        input.interest,
        input.duration,
        input.purposeHash,
        input.policyHash,
        input.pdfUri
      )
      return tx.wait()
    }
    return track ? track('notes.createNoteWithInvoice', action) : action()
  }
}