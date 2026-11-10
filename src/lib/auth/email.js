// Transactional email through Resend (plain `fetch`, no SDK), plus the message texts.
//
// - FAIL CLOSED (rule 5): without RESEND_API_KEY and EMAIL_FROM nothing is sent and `sendEmail` throws; callers report a generic
//   failure and never pretend a mail went out.
// - Links are built from AUTH_URL, never from the request's Host header (host-header poisoning of reset links).
// - The key, the links and the tokens are never logged.
// - With EMAIL_FROM = onboarding@resend.dev Resend delivers only to the Resend account owner's address until a domain is verified.
//
// STUB (browser tests only): with AUTH_EMAIL_STUB=1 the message is appended to `tmp/mail-outbox.jsonl` instead of being sent. The
// stub is refused when NODE_ENV is "production" or when running on Vercel (VERCEL is set), so it cannot exist on a deployment, and it
// is a file on the developer's disk, not an HTTP endpoint, so there is nothing to call from outside.
import fs from 'node:fs';
import path from 'node:path';

/** @param {Record<string, string | undefined>} [env] */
export function emailStubEnabled(env = process.env) {
  return env.AUTH_EMAIL_STUB === '1' && env.NODE_ENV !== 'production' && !env.VERCEL;
}

/** Where the stub writes (gitignored). */
export const OUTBOX_PATH = path.resolve(process.cwd(), 'tmp', 'mail-outbox.jsonl');

/**
 * The public origin used in links: AUTH_URL's origin. Throws if AUTH_URL is missing or not a URL.
 * @param {Record<string, string | undefined>} [env]
 */
export function appOrigin(env = process.env) {
  if (!env.AUTH_URL) throw new Error('AUTH_URL is not set');
  return new URL(env.AUTH_URL).origin;
}

/**
 * @param {'verify-email' | 'reset-password'} page
 * @param {string} token
 * @param {Record<string, string | undefined>} [env]
 */
export function emailLink(page, token, env = process.env) {
  return `${appOrigin(env)}/${page}?token=${encodeURIComponent(token)}`;
}

/** @param {string} link */
export function verificationMessage(link) {
  return {
    subject: 'Confirm your VeriCert email',
    text: `Confirm your email to finish creating your VeriCert account:\n\n${link}\n\nThe link works once and expires in 24 hours. If you did not sign up, ignore this message: no account is usable until the link is opened.`,
    html: `<p>Confirm your email to finish creating your VeriCert account:</p><p><a href="${link}">Confirm email</a></p><p>The link works once and expires in 24 hours. If you did not sign up, ignore this message: no account is usable until the link is opened.</p>`,
  };
}

/** Sent when someone signs up with an address that already has an account (never reveals this on the web page). @param {string} origin */
export function existingAccountMessage(origin) {
  return {
    subject: 'You already have a VeriCert account',
    text: `Someone (possibly you) tried to sign up to VeriCert with this address, which already has an account.\n\nSign in: ${origin}/login\nForgot your password: ${origin}/forgot-password\n\nIf it was not you, ignore this message: nothing has changed.`,
    html: `<p>Someone (possibly you) tried to sign up to VeriCert with this address, which already has an account.</p><p><a href="${origin}/login">Sign in</a> · <a href="${origin}/forgot-password">Forgot your password</a></p><p>If it was not you, ignore this message: nothing has changed.</p>`,
  };
}

/** @param {string} link */
export function resetMessage(link) {
  return {
    subject: 'Reset your VeriCert password',
    text: `Choose a new VeriCert password:\n\n${link}\n\nThe link works once and expires in 1 hour. If you did not ask for this, ignore this message: your password is unchanged.`,
    html: `<p>Choose a new VeriCert password:</p><p><a href="${link}">Reset password</a></p><p>The link works once and expires in 1 hour. If you did not ask for this, ignore this message: your password is unchanged.</p>`,
  };
}

/**
 * @param {{ to: string, subject: string, text: string, html: string }} message
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<void>}
 */
export async function sendEmail({ to, subject, text, html }, env = process.env) {
  if (emailStubEnabled(env)) {
    fs.mkdirSync(path.dirname(OUTBOX_PATH), { recursive: true });
    fs.appendFileSync(
      OUTBOX_PATH,
      `${JSON.stringify({ to, subject, text, at: new Date().toISOString() })}\n`,
    );
    return;
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('email is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`email provider answered HTTP ${res.status}`);
}
