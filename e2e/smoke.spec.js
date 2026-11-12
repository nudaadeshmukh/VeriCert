import { expect, test } from '@playwright/test';

test('home page renders and links to sign-in', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'VeriCert' })).toBeVisible();
  await expect(page.getByText('Verify NPTEL certificates in bulk')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test('design tokens are applied (dark canvas)', async ({ page }) => {
  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(11, 11, 11)'); // colors.canvas #0b0b0b
});

test('lead paragraph is not squeezed (token/utility collisions)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const box = await page.getByText('Verify NPTEL certificates in bulk').boundingBox();
  expect(box.width).toBeGreaterThan(400); // max-w-xl = 36rem = 576px
  expect(box.height).toBeLessThan(120); // two lines, not a one-word-per-line column
});

test('/api/health answers with a consistent shape', async ({ request }) => {
  const res = await request.get('/api/health');
  const body = await res.json();
  expect(['up', 'down']).toContain(body.db);
  expect(body.ok).toBe(body.db === 'up');
  expect(res.status()).toBe(body.ok ? 200 : 503);
  expect(body.version).toMatch(/^\d+\.\d+\.\d+\+/);
  expect(res.headers()['cache-control']).toBe('no-store');
});
