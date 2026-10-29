import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://businessfinancialgoal.netlify.app'),
  title: 'Financial Goal — Income & Work Planning for Freelancers',
  description: 'Set your business financial goal, track working hours and income, and plan tax reserves. Built for Dutch freelancers. Use Financial Goal on phone or desktop.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  verification: { google: 'kqPRLKd1MaKho3JjAUNFwmq_MJhvtYnwJDQDit2zb6c' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Financial Goal',
    title: 'Financial Goal — Income & Work Planning for Freelancers',
    description: 'A clearer financial year for Dutch freelancers. Set your take-home goal, log your work and review your progress.',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary',
    title: 'Financial Goal — Income & Work Planning for Freelancers',
    description: 'Set your take-home goal, track your working hours and plan your freelance year.',
  },
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
