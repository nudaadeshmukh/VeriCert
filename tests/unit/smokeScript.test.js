import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/smoke-nptel.mjs'), 'utf8');

describe('scripts/smoke-nptel.mjs never exposes the Vercel bypass secret', () => {
  it('uses the secret to set the x-vercel-protection-bypass request header', () => {
    expect(src).toMatch(/'x-vercel-protection-bypass': bypass/);
  });
  it('never passes the secret (or the headers object) to console output', () => {
    for (const line of src.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))) {
      expect(line).not.toMatch(/\bbypass\b(?!-)|BYPASS_SECRET|headers/i);
    }
    expect(src).not.toMatch(/JSON\.stringify\([^)]*headers/);
  });
  it('is read from the environment, never hardcoded', () => {
    expect(src).toMatch(/process\.env\.VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(src).not.toMatch(/bypass\s*=\s*['"`]/);
  });
});

describe('scripts/smoke-nptel.mjs and SMOKE_SESSION_COOKIE (Phase 5)', () => {
  it('sends the cookie as the Cookie header, read from the environment, never hardcoded', () => {
    expect(src).toMatch(/process\.env\.SMOKE_SESSION_COOKIE/);
    expect(src).toMatch(/cookie: sessionCookie/);
    expect(src).not.toMatch(/sessionCookie\s*=\s*['"`]/);
  });
  it('never passes the cookie to console output', () => {
    for (const line of src.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))) {
      expect(line).not.toMatch(/sessionCookie|SESSION_COOKIE/);
    }
  });
  it('the secret values in .env are in no file that git could commit (tracked or not ignored)', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const envFile = path.join(root, '.env');
    if (!fs.existsSync(envFile)) return; // CI has no .env
    const secrets = {};
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(
        /^(SMOKE_SESSION_COOKIE|VERCEL_AUTOMATION_BYPASS_SECRET|AUTH_SECRET|AUTH_GOOGLE_SECRET|RESEND_API_KEY)=(.*)$/,
      );
      if (m) {
        const raw = m[2].trim().replace(/^["']|["']$/g, '');
        // For the cookie, the value after "name=" is the secret; the cookie name is public.
        const value = m[1] === 'SMOKE_SESSION_COOKIE' ? raw.slice(raw.indexOf('=') + 1) : raw;
        if (value.length >= 12) secrets[m[1]] = value;
      }
    }
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
    })
      .toString()
      .split('\0')
      .filter(Boolean)
      .filter(
        (f) =>
          fs.existsSync(path.join(root, f)) && !/\.(png|jpe?g|pdf|woff2?|ico|wasm|traineddata|gz)$/i.test(f),
      );
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const [name, value] of Object.entries(secrets)) {
        expect(text.includes(value), `${name} appears in ${f}`).toBe(false);
      }
    }
  });
});
