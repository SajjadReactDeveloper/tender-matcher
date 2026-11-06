import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';

import './globals.css';
import './shell.css';

const body = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'Tender Matcher',
  description: 'Active tenders matched to Funavry Technologies',
  robots: { index: false, follow: false },
};

// Dynamic so every response can carry its own CSP nonce (see src/proxy.ts).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={body.variable}>
      <body>{children}</body>
    </html>
  );
}
