// Placeholder for the signed-in area (the real dashboard is Phase 7). It exists in Phase 5 only so there is somewhere to land after
// signing in, and to prove the protection: the proxy sends signed-out visitors to /login, and this page re-checks the user itself.
import { signOut } from '../../src/lib/auth/auth.js';
import { requirePageUser } from '../../src/lib/auth/guards.js';

export const metadata = { title: 'Dashboard · VeriCert', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requirePageUser('/dashboard');

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <main className="mx-auto max-w-[1640px] px-6 py-16">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-full bg-brand" />
        <span className="text-button-lg font-medium text-on-primary">VeriCert</span>
      </div>
      <p className="mt-16 font-mono text-mono-eyebrow text-mute">PICT · NPTEL CERTIFICATE VERIFICATION</p>
      <h1 className="mt-4 text-display-sm font-normal text-on-primary">You are signed in</h1>
      <p className="mt-4 max-w-xl text-body text-ash">
        Signed in as{' '}
        <span data-testid="signed-in-as" className="text-on-primary">
          {user.email}
        </span>
        . Certificate upload and the results dashboard arrive in a later phase.
      </p>
      <form action={logout} className="mt-8">
        <button
          type="submit"
          className="h-11 rounded-full border border-hairline-soft bg-canvas-soft px-6 text-button-lg font-medium text-on-primary hover:border-ash"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
