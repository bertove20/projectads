import type { Metadata } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

// Di-host sendiri oleh Next.js saat build: tidak ada request ke Google dari browser pengguna.
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex', display: 'swap' });

export const metadata: Metadata = {
  title: 'EAIP',
  description: 'Enterprise Ads Intelligence Platform',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={plex.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
