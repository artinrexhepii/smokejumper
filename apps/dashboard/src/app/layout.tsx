import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { NavBar } from '../components/NavBar'
import './globals.css'

export const metadata: Metadata = {
  title: 'Smokejumper',
  description: 'AI incident copilot',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        <main className="container">{children}</main>
      </body>
    </html>
  )
}
