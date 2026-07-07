import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Hanken_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { AppFrame } from '../components/AppFrame'
import './globals.css'

const display = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const sans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Smokejumper — incident command',
  description: 'Smokejumper dispatches AI investigators into your incidents and returns evidence-cited diagnoses.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="grain" aria-hidden="true" />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  )
}
