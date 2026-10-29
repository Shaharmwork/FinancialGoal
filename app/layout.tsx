import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://businessfinancialgoal.netlify.app'),
  title: 'Financial Goal — Tax Planning for Dutch Freelancers',
  description: 'Prepare for your year-end tax bill with Financial Goal. Track income and expenses, estimate tax reserves and follow your take-home goal. For Dutch freelancers.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  verification: { google: 'kqPRLKd1MaKho3JjAUNFwmq_MJhvtYnwJDQDit2zb6c' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Financial Goal',
    title: 'Financial Goal — Tax Planning for Dutch Freelancers',
    description: 'Prepare for your year-end tax bill. Track income and expenses, review estimated tax reserves and keep your take-home goal in view.',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary',
    title: 'Financial Goal — Tax Planning for Dutch Freelancers',
    description: 'Plan ahead for your year-end tax bill with income tracking, tax reserve estimates and take-home goals for Dutch freelancers.',
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
