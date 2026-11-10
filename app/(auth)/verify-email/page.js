import AccountForm from '../../../src/components/auth/AccountForm.js';
import AuthShell, { AuthLink } from '../../../src/components/auth/AuthShell.js';

export const metadata = { title: 'Confirm your email · VeriCert', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Opening the link does NOT use the token: mail scanners and link previewers open links. Only the button (a POST) does.
export default async function VerifyEmailPage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.token === 'string' ? params.token : '';
  return (
    <AuthShell
      eyebrow="PICT · NPTEL CERTIFICATE VERIFICATION"
      title="Confirm your email"
      intro="Press the button to finish creating your account."
      footer={
        <p>
          <AuthLink href="/login">Go to sign in</AuthLink>
        </p>
      }
    >
      {token ? (
        <AccountForm
          endpoint="/api/auth/account/verify-email"
          submitLabel="Confirm my email"
          fixed={{ token }}
          fields={[]}
        />
      ) : (
        <p role="alert" className="text-body-sm text-brand">
          <span className="font-medium">Problem: </span>This link is incomplete. Open the link from the email
          again, or <AuthLink href="/signup">sign up</AuthLink> to get a new one.
        </p>
      )}
    </AuthShell>
  );
}
