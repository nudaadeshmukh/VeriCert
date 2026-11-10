import { defineConfig, devices } from '@playwright/test';
import { TEST_DB } from './e2e/helpers/testEnv.js';

// Locally this starts its own `next dev` on :3000 against a SEPARATE database (`<MONGODB_DB>_test`, dropped before and after the
// run by e2e/global-setup.js) with the email stub on, so tests never touch real accounts and never send email. Stop any other
// dev server on :3000 first. To test a deployment instead, set PLAYWRIGHT_BASE_URL (the auth specs then skip themselves).
const port = 3000;
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.js',
  // The first hit of a route on a cold `next dev` compiles it (pdf.js, tesseract), which once took >30 s.
  timeout: 60_000,
  // One worker: these tests run OCR with a wall-clock budget (8 s per certificate). Three Chromium instances running OCR in
  // parallel next to the dev server starved each other and produced `ocr_timeout` failures (C-018).
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          MONGODB_DB: TEST_DB,
          AUTH_URL: `http://localhost:${port}`,
          AUTH_EMAIL_STUB: '1',
          ALLOWED_EMAIL_DOMAIN: 'pict.edu',
          ADMIN_EMAILS: '',
        },
      },
});
