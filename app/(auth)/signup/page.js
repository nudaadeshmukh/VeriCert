import AccountForm from '../../../src/components/auth/AccountForm.js';
import AuthShell, { AuthLink } from '../../../src/components/auth/AuthShell.js';
import { PASSWORD_MIN_LENGTH } from '../../../src/lib/auth/password.js';

export const metadata = { title: 'Create an account · VeriCert', robots: { index: false, follow: false } };

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="PICT · NPTEL CERTIFICATE VERIFICATION"
      title="Create an account"
      intro="Only @pict.edu addresses can sign up. We will email you a link to confirm the address."
      footer={
        <p>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </p>
      }
    >
      <AccountForm
        endpoint="/api/auth/account/signup"
        submitLabel="Create account"
        fields={[
          {
            name: 'email',
            label: 'PICT email',
            type: 'email',
            autoComplete: 'username',
            hint: 'name@pict.edu',
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            autoComplete: 'new-password',
            hint: `At least ${PASSWORD_MIN_LENGTH} characters. Avoid common passwords.`,
          },
        ]}
      />
    </AuthShell>
  );
}
