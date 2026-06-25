import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Smokejumper',
  description: 'AI incident copilot',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <span className="nav-brand">smokejumper</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  )
}
