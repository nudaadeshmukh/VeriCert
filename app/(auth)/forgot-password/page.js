import AccountForm from '../../../src/components/auth/AccountForm.js';
import AuthShell, { AuthLink } from '../../../src/components/auth/AuthShell.js';

export const metadata = { title: 'Forgot your password · VeriCert', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="PICT · NPTEL CERTIFICATE VERIFICATION"
      title="Forgot your password"
      intro="Enter your PICT email and we will send you a link to choose a new password."
      footer={
        <p>
          <AuthLink href="/login">Back to sign in</AuthLink>
        </p>
      }
    >
      <AccountForm
        endpoint="/api/auth/account/forgot-password"
        submitLabel="Send the link"
        fields={[{ name: 'email', label: 'PICT email', type: 'email', autoComplete: 'username' }]}
      />
    </AuthShell>
  );
}
