import { defineConfig, devices } from '@playwright/test';

// Locally this runs against `next dev` (reusing a server already on :3000). In CI-style runs
// set PLAYWRIGHT_BASE_URL or build first and use `npm run start`.
const port = 3000;
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
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
        url: `http://localhost:${port}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
