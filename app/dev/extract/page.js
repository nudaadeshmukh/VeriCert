// Dev-only scratch page for the Phase 2 Playwright tests. It does not exist in production:
// `notFound()` makes /dev/extract answer 404 whenever NODE_ENV is "production".
import { notFound } from 'next/navigation';
import ExtractScratch from './ExtractScratch.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'extract (dev)', robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ExtractScratch />;
}
