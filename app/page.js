// Placeholder home page for Phase 1. The real landing page is Phase 9; sign-in is Phase 5.
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
        This site is being set up. Sign-in and certificate verification are not available yet.
      </p>
    </main>
  );
}
