// Helpers for tests that need an account. They use the real sign-up, verification and sign-in endpoints.
import fs from 'node:fs';
import { expect } from '@playwright/test';
import { OUTBOX } from './testEnv.js';

export const PASSWORD = 'correct horse battery staple 42';
let counter = 0;
export const uniqueEmail = () => `e2e${Date.now()}x${counter++}@pict.edu`;

/** The newest stub email to `to` (the stub writes tmp/mail-outbox.jsonl; it is disabled on Vercel and in production). */
export async function latestMail(to, subjectPart) {
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(OUTBOX)) {
      const rows = fs
        .readFileSync(OUTBOX, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((m) => m.to === to && m.subject.toLowerCase().includes(subjectPart));
      if (rows.length) return rows.at(-1);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no "${subjectPart}" email for the test address`);
}

export const linkIn = (mail) => mail.text.match(/https?:\/\/\S+/)[0];

const post = (request, url, data) =>
  request.post(url, { data, headers: { 'content-type': 'application/json' } });

/** Sign up, confirm the email and sign in through the API: the request context keeps the session cookie. */
export async function registerAndLogin(request, email = uniqueEmail()) {
  expect((await post(request, '/api/auth/account/signup', { email, password: PASSWORD })).status()).toBe(200);
  const token = new URL(linkIn(await latestMail(email, 'confirm'))).searchParams.get('token');
  expect((await post(request, '/api/auth/account/verify-email', { token })).status()).toBe(200);
  expect((await post(request, '/api/auth/account/login', { email, password: PASSWORD })).status()).toBe(200);
  return email;
}
