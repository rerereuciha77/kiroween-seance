import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'SÉANCE — the haunted archive',
  description:
    'An agent-native gateway to the machine-readable internet that predates the web: Gopher, Usenet and Finger, exposed over MCP.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}