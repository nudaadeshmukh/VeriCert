import { redirect } from 'next/navigation';
import AccountForm from '../../../src/components/auth/AccountForm.js';
import AuthShell, { AuthLink } from '../../../src/components/auth/AuthShell.js';
import { signIn } from '../../../src/lib/auth/auth.js';
import { requireUser } from '../../../src/lib/auth/guards.js';
import { safeNext } from '../../../src/lib/auth/redirect.js';

export const metadata = { title: 'Sign in · VeriCert', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** What the error codes Auth.js puts in the URL mean for a person. */
const ERRORS = {
  AccessDenied: 'Only PICT staff accounts (@pict.edu) can sign in. That account was not allowed.',
  Configuration: 'Sign-in is not available right now. Please try again later.',
  Verification: 'That sign-in link is no longer valid. Please try again.',
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params?.next);

  // Already signed in: go where they were headed.
  const guard = await requireUser();
  if (guard.ok) redirect(next);

  async function signInWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: next });
  }

  const message = params?.error ? (ERRORS[params.error] ?? 'Sign-in failed. Please try again.') : null;

  return (
    <AuthShell
      eyebrow="PICT · NPTEL CERTIFICATE VERIFICATION"
      title="Sign in"
      intro="For PICT staff. Use your @pict.edu account."
      footer={
        <p>
          New here? <AuthLink href="/signup">Create an account</AuthLink>
        </p>
      }
    >
      {message ? (
        <p role="alert" className="mb-6 text-body-sm text-brand">
          <span className="font-medium">Problem: </span>
          {message}
        </p>
      ) : null}
      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="h-11 w-full rounded-full border border-hairline-soft bg-canvas-soft px-6 text-button-lg font-medium text-on-primary hover:border-ash"
        >
          Continue with Google
        </button>
      </form>
      <p className="my-6 text-center font-mono text-mono-caps text-mute">OR WITH EMAIL</p>
      <AccountForm
        endpoint="/api/auth/account/login"
        redirectTo={next}
        submitLabel="Sign in"
        fields={[
          { name: 'email', label: 'Email', type: 'email', autoComplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
        ]}
      />
      <p className="mt-6 text-body-sm">
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
      </p>
    </AuthShell>
  );
}
