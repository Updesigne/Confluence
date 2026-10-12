import { ADDRESSES } from './addresses'

export type VenueOption = {
  address: `0x${string}`
  name: string
  description: string
  symbol: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function getVenueOptions(chainId: number): VenueOption[] {
  const addresses = ADDRESSES[chainId]
  if (!addresses) return []

  return [
    {
      address: addresses.mockVenue,
      name: 'Mock Venue',
      description: 'Fixed-rate yield',
      symbol: 'USDG',
    },
    {
      address: addresses.notes,
      name: 'Notes',
      description: 'Policy-bound borrowing',
      symbol: 'USDG',
    },
    {
      address: addresses.depegAdapter,
      name: 'USDG Depeg',
      description: 'Stablecoin depeg capture',
      symbol: 'USDG',
    },
  ].filter((venue) => venue.address.toLowerCase() !== ZERO_ADDRESS)
}