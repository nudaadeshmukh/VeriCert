import AccountForm from '../../../src/components/auth/AccountForm.js';
import AuthShell, { AuthLink } from '../../../src/components/auth/AuthShell.js';
import { PASSWORD_MIN_LENGTH } from '../../../src/lib/auth/password.js';

export const metadata = {
  title: 'Choose a new password · VeriCert',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.token === 'string' ? params.token : '';
  return (
    <AuthShell
      eyebrow="PICT · NPTEL CERTIFICATE VERIFICATION"
      title="Choose a new password"
      intro="The link works once. Afterwards you are signed out everywhere."
      footer={
        <p>
          <AuthLink href="/login">Back to sign in</AuthLink>
        </p>
      }
    >
      {token ? (
        <AccountForm
          endpoint="/api/auth/account/reset-password"
          submitLabel="Change password"
          fixed={{ token }}
          fields={[
            {
              name: 'password',
              label: 'New password',
              type: 'password',
              autoComplete: 'new-password',
              hint: `At least ${PASSWORD_MIN_LENGTH} characters. Avoid common passwords.`,
            },
          ]}
        />
      ) : (
        <p role="alert" className="text-body-sm text-brand">
          <span className="font-medium">Problem: </span>This link is incomplete. Ask for a new one from the{' '}
          <AuthLink href="/forgot-password">forgot password</AuthLink> page.
        </p>
      )}
    </AuthShell>
  );
}
