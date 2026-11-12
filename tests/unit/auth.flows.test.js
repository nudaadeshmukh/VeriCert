import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideGoogleSignIn } from '../../src/lib/auth/googleSignIn.js';
import {
  forgotPasswordFlow,
  loginFlow,
  resetPasswordFlow,
  signupFlow,
  verifyEmailFlow,
} from '../../src/lib/auth/flows.js';
import { fakeDb } from './helpers/fakeDb.js';

vi.setConfig({ testTimeout: 60000 }); // bcrypt at cost 12 is deliberately slow
const env = { ALLOWED_EMAIL_DOMAIN: 'pict.edu', AUTH_URL: 'https://app.example' };
const GOOD = 'correct horse battery staple 42';
let db;
let sent;
const send = async (m) => void sent.push(m);
const tokenFrom = (m) => new URL(m.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
const ctx = (extra) => ({ db, ip: '1.2.3.4', env, send, ...extra });
const audits = (action) => db.all('audit_logs').filter((a) => a.action === action);

async function signupAndVerify(email = 'staff@pict.edu', password = GOOD) {
  await signupFlow(ctx({ email, password }));
  const res = await verifyEmailFlow(ctx({ token: tokenFrom(sent.at(-1)) }));
  expect(res.status).toBe(200);
}

beforeEach(() => {
  db = fakeDb();
  sent = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('signup', () => {
  it('refuses other domains and logs the attempt', async () => {
    const r = await signupFlow(ctx({ email: 'outsider@example.com', password: GOOD }));
    expect(r.status).toBe(403);
    expect(sent).toHaveLength(0);
    expect(db.all('users')).toHaveLength(0);
    expect(audits('login_rejected_domain')[0]).toMatchObject({
      target: 'outsider@example.com',
      ip: '1.2.3.4',
    });
  });
  it('refuses look-alike domains', async () => {
    for (const email of ['x@pict.edu.evil.com', 'x@notpict.edu']) {
      expect((await signupFlow(ctx({ email, password: GOOD }))).status).toBe(403);
    }
  });
  it('refuses weak passwords', async () => {
    let i = 0; // a different address each time: rejected attempts count towards the per-email throttle
    for (const password of ['short', 'password123', 'staffmember.pict.edu', 5]) {
      const email = `staffmember${i++}@pict.edu`;
      const pw = password === 'staffmember.pict.edu' ? `xx-${email.split('@')[0]}-xx` : password;
      expect((await signupFlow(ctx({ email, password: pw }))).status).toBe(400);
    }
  });
  it('creates an UNVERIFIED account, stores only a bcrypt hash and sends a verification link', async () => {
    const r = await signupFlow(ctx({ email: 'Staff@PICT.edu', password: GOOD }));
    expect(r.status).toBe(200);
    const [u] = db.all('users');
    expect(u.email).toBe('staff@pict.edu');
    expect(u.emailVerified).toBeFalsy();
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(JSON.stringify(u)).not.toContain(GOOD);
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0]);
    expect(JSON.stringify(db.all('email_tokens'))).not.toContain(token); // stored hashed
  });
  it('gives the same answer for an address that already has an account (no enumeration)', async () => {
    await signupAndVerify();
    const first = await signupFlow(ctx({ email: 'fresh@pict.edu', password: GOOD }));
    const again = await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    expect(sent.at(-1).subject).toMatch(/already have/i);
  });
  it('is throttled per email', async () => {
    const results = [];
    for (let i = 0; i < 5; i++)
      results.push((await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }))).status);
    expect(results).toContain(429);
  });
});

describe('verify and login', () => {
  it('cannot log in until verified, with the same error as a bad password otherwise', async () => {
    await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    const r = await loginFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    expect(r.status).toBe(403);
    expect(r.session).toBeUndefined();
    const wrong = await loginFlow(ctx({ email: 'staff@pict.edu', password: 'wrong password here' }));
    const unknown = await loginFlow(ctx({ email: 'nobody@pict.edu', password: 'wrong password here' }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
  it('a verification token works once', async () => {
    await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    const token = tokenFrom(sent[0]);
    expect((await verifyEmailFlow(ctx({ token }))).status).toBe(200);
    expect((await verifyEmailFlow(ctx({ token }))).status).toBe(400);
  });
  it('an expired token is refused', async () => {
    await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    const later = new Date(Date.now() + 25 * 3600 * 1000);
    expect((await verifyEmailFlow(ctx({ token: tokenFrom(sent[0]), now: later }))).status).toBe(400);
  });
  it('a verified user gets a database session', async () => {
    await signupAndVerify();
    const r = await loginFlow(ctx({ email: 'STAFF@pict.edu', password: GOOD }));
    expect(r.status).toBe(200);
    expect(db.all('sessions')).toHaveLength(1);
    expect(db.all('sessions')[0].sessionToken).toBe(r.session.sessionToken);
    expect(audits('login')).toHaveLength(1);
  });
  it('a disabled account cannot log in', async () => {
    await signupAndVerify();
    db.all('users')[0].disabled = true;
    const r = await loginFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    expect(r.status).toBe(403);
    expect(r.session).toBeUndefined();
  });
  it('a non-pict address cannot log in even with a stored password', async () => {
    await db
      .collection('users')
      .insertOne({ email: 'x@gmail.com', passwordHash: 'x', emailVerified: new Date() });
    expect((await loginFlow(ctx({ email: 'x@gmail.com', password: GOOD }))).status).toBe(401);
  });
  it('throttles repeated failures', async () => {
    await signupAndVerify();
    const codes = [];
    for (let i = 0; i < 12; i++)
      codes.push((await loginFlow(ctx({ email: 'staff@pict.edu', password: 'nope nope nope' }))).status);
    expect(codes).toContain(429);
    expect((await loginFlow(ctx({ email: 'staff@pict.edu', password: GOOD }))).status).toBe(429);
  });
});

describe('forgot and reset', () => {
  it('answers identically for known and unknown addresses, and only emails known ones', async () => {
    await signupAndVerify();
    sent = [];
    const known = await forgotPasswordFlow(ctx({ email: 'staff@pict.edu' }));
    const unknown = await forgotPasswordFlow(ctx({ email: 'nobody@pict.edu' }));
    const foreign = await forgotPasswordFlow(ctx({ email: 'x@gmail.com' }));
    expect(unknown.body).toEqual(known.body);
    expect(foreign.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
  });
  it('changes the password once, ends all sessions, and the weak password does not burn the link', async () => {
    await signupAndVerify();
    await loginFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    sent = [];
    await forgotPasswordFlow(ctx({ email: 'staff@pict.edu' }));
    const token = tokenFrom(sent[0]);
    expect((await resetPasswordFlow(ctx({ token, password: 'password123' }))).status).toBe(400);
    const NEW = 'another long passphrase 99';
    expect((await resetPasswordFlow(ctx({ token, password: NEW }))).status).toBe(200);
    expect((await resetPasswordFlow(ctx({ token, password: NEW }))).status).toBe(400); // single use
    expect(db.all('sessions')).toHaveLength(0);
    expect((await loginFlow(ctx({ email: 'staff@pict.edu', password: GOOD }))).status).toBe(401);
    expect((await loginFlow(ctx({ email: 'staff@pict.edu', password: NEW }))).status).toBe(200);
  });
  it('a verification token cannot reset a password', async () => {
    await signupFlow(ctx({ email: 'staff@pict.edu', password: GOOD }));
    expect(
      (await resetPasswordFlow(ctx({ token: tokenFrom(sent[0]), password: 'a fine new passphrase 1' })))
        .status,
    ).toBe(400);
  });
});

describe('Google sign-in decision', () => {
  const base = () => ({ account: { provider: 'google' }, db, ip: '9.9.9.9', domain: 'pict.edu' });
  it('allows a verified @pict.edu profile', async () => {
    expect(
      await decideGoogleSignIn({
        ...base(),
        profile: { email: 'staff.member@pict.edu', email_verified: true },
      }),
    ).toBe(true);
  });
  it('refuses a gmail account and logs the attempted address', async () => {
    expect(
      await decideGoogleSignIn({
        ...base(),
        profile: { email: 'outsider@example.com', email_verified: true },
      }),
    ).toBe(false);
    expect(audits('login_rejected_domain')[0]).toMatchObject({
      target: 'outsider@example.com',
      ip: '9.9.9.9',
    });
  });
  it('refuses an unverified Google email, look-alikes and other providers', async () => {
    expect(
      await decideGoogleSignIn({ ...base(), profile: { email: 'a@pict.edu', email_verified: false } }),
    ).toBe(false);
    expect(
      await decideGoogleSignIn({ ...base(), profile: { email: 'a@pict.edu.x.com', email_verified: true } }),
    ).toBe(false);
    expect(
      await decideGoogleSignIn({
        ...base(),
        account: { provider: 'github' },
        profile: { email: 'a@pict.edu', email_verified: true },
      }),
    ).toBe(false);
  });
  it('refuses a disabled account', async () => {
    await db.collection('users').insertOne({ email: 'a@pict.edu', disabled: true });
    expect(
      await decideGoogleSignIn({ ...base(), profile: { email: 'a@pict.edu', email_verified: true } }),
    ).toBe(false);
  });
  it('removes the password of an unverified signup before linking (pre-hijack defence)', async () => {
    await signupFlow(ctx({ email: 'victim@pict.edu', password: GOOD }));
    expect(
      await decideGoogleSignIn({ ...base(), profile: { email: 'victim@pict.edu', email_verified: true } }),
    ).toBe(true);
    expect(db.all('users')[0].passwordHash).toBeFalsy();
  });
  it('fails closed when the database fails', async () => {
    db.failIf = () => {
      throw new Error('down');
    };
    expect(
      await decideGoogleSignIn({ ...base(), profile: { email: 'a@pict.edu', email_verified: true } }),
    ).toBe(false);
  });
});

describe('email send failures are logged with a reason that cannot leak', () => {
  it('logs our own messages and reduces anything else to "other"', async () => {
    const logged = [];
    console.error.mockImplementation((l) => logged.push(l));
    const failWith = (message) => async () => {
      throw new Error(message);
    };
    let r = await signupFlow(
      ctx({ email: 'a1@pict.edu', password: GOOD, send: failWith('email provider answered HTTP 403') }),
    );
    expect(r.status).toBe(503);
    r = await signupFlow(
      ctx({ email: 'a2@pict.edu', password: GOOD, send: failWith('boom for a2@pict.edu key re_abc123') }),
    );
    expect(r.status).toBe(503);
    const lines = logged.map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ event: 'signup_failed', reason: 'email provider answered HTTP 403' });
    expect(lines[1]).toMatchObject({ event: 'signup_failed', reason: 'other' });
    expect(logged.join('')).not.toMatch(/a2@pict\.edu|re_abc123/);
  });
});
