// Dev-only scratch page for the Phase 4 browser tests: runs the whole chain on a file in THIS browser.
// It does not exist in production: `notFound()` makes /dev/tamper answer 404 whenever NODE_ENV is "production".
import { notFound } from 'next/navigation';
import TamperScratch from './TamperScratch.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'tamper (dev)', robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <TamperScratch />;
}
