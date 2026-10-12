import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { QueryProvider } from '@/providers/QueryProvider'
import { Web3Provider } from '@/providers/Web3Provider'
import { TxTrackerProvider } from '@/providers/TxTrackerProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Confluence Protocol — Policy-bound capital aggregation',
  description: 'Investment policy, on-chain.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryProvider>
  <Web3Provider>
    <TxTrackerProvider>{children}</TxTrackerProvider>
  </Web3Provider>
</QueryProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}