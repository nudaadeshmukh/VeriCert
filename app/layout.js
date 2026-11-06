import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// DESIGN.md "Note on Font Substitutes": Inter replaces waldenburgNormal; IBM Plex Mono is
// used as specified (eyebrows and small-caps labels only).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata = {
  title: 'VeriCert · PICT NPTEL certificate verification',
  description: 'Bulk verification of NPTEL certificates for PICT staff.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-canvas text-ash antialiased">{children}</body>
    </html>
  );
}
