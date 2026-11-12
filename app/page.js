// Placeholder home page. The real landing page is Phase 9; it links to sign-in (Phase 5).
import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-[1640px] px-6 py-24">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-full bg-brand" />
        <span className="text-button-lg font-medium text-on-primary">VeriCert</span>
      </div>
      <p className="mt-16 font-mono text-mono-eyebrow text-mute">PICT · NPTEL CERTIFICATE VERIFICATION</p>
      <h1 className="mt-4 text-display-md font-normal text-on-primary xs:text-display-xl">VeriCert</h1>
      <p className="mt-6 max-w-xl text-subtitle">
        Verify NPTEL certificates in bulk. For PICT staff: sign in with your @pict.edu account.
      </p>
      <Link
        href="/login"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-canvas-light px-6 text-button-lg font-medium text-ink hover:bg-canvas-paper"
      >
        Sign in
      </Link>
    </main>
  );
}
