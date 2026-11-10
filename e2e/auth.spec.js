// Email/password accounts end to end, in a real browser, against the *_test database with the email stub.
import { expect, test } from '@playwright/test';
import { latestMail, linkIn, PASSWORD, uniqueEmail } from './helpers/auth.js';

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  'needs the local server with the email stub and the test database',
);

// Next.js adds its own role=alert element (the route announcer); ours are the others.
const alertOf = (page) => page.locator('[role=alert]:not(#__next-route-announcer__)');
const signInButton = (page) => page.getByRole('button', { name: 'Sign in', exact: true });

test('sign up, confirm the email, sign in, sign out, reset the password, sign in again', async ({ page }) => {
  const email = uniqueEmail();
  const NEW_PASSWORD = 'a different long passphrase 77';

  // Protected pages send signed-out visitors to the sign-in page.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);

  // Sign up.
  await page.goto('/signup');
  await page.getByLabel('PICT email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('confirmation email');

  // Not confirmed yet: sign-in is refused.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await signInButton(page).click();
  await expect(alertOf(page)).toContainText('Confirm your email');

  // Confirm: opening the link does nothing by itself, the button does.
  await page.goto(linkIn(await latestMail(email, 'confirm')));
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page.getByRole('status')).toContainText('confirmed');

  // Sign in, see the signed-in page, sign out.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await signInButton(page).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('signed-in-as')).toHaveText(email);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);

  // Reset the password.
  await page.goto('/forgot-password');
  await page.getByLabel('PICT email').fill(email);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('If that address has an account');
  const resetUrl = linkIn(await latestMail(email, 'reset'));
  await page.goto(resetUrl);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toContainText('changed');

  // The link works once.
  await page.goto(resetUrl);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(alertOf(page)).toContainText('invalid or has expired');

  // Old password refused, new one works.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await signInButton(page).click();
  await expect(alertOf(page)).toContainText('Invalid email or password');
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await signInButton(page).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('only @pict.edu addresses can sign up', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('PICT email').fill('someone@gmail.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(alertOf(page)).toContainText('@pict.edu');
});

test('the API is closed without a session', async ({ request }) => {
  const verify = await request.post('/api/verify', {
    data: { url: 'https://nptel.ac.in/verify/NOC-AAAA-BBBB-CCCCC' },
  });
  expect(verify.status()).toBe(401);
  expect((await request.get('/api/health')).status()).toBe(200); // the public exception
});

test('the sign-in page offers Google and the email form; a refused account shows the reason', async ({
  page,
}) => {
  await page.goto('/login?error=AccessDenied');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(alertOf(page)).toContainText('@pict.edu');
});

test('an open-redirect next parameter is ignored', async ({ page }) => {
  const email = uniqueEmail();
  await page.request.post('/api/auth/account/signup', { data: { email, password: PASSWORD } });
  const token = new URL(linkIn(await latestMail(email, 'confirm'))).searchParams.get('token');
  await page.request.post('/api/auth/account/verify-email', { data: { token } });
  await page.goto('/login?next=https://evil.example/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await signInButton(page).click();
  await expect(page).toHaveURL(/localhost:3000\/dashboard$/);
});
