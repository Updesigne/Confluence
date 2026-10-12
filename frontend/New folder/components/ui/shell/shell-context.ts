// components/shell/shell-context.tsx
'use client'
import { createContext, useContext } from 'react'

export type ShellApi = {
  notify: (message: string) => void
  openMandateModal: () => void
  openTxDrawer: () => void
}

export const ShellContext = createContext<ShellApi | null>(null)

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside the (app) layout')
  return ctx
}