// The email/password account flows: sign up, verify email, sign in, forgot password, reset password.
//
// Plain functions of (database, input) returning `{ status, body, session? }`, so they are tested without HTTP; the route handlers in
// app/api/auth/account/* only parse the request, call one of these and set the cookie.
//
// Rules applied everywhere (plan, Phase 5; CLAUDE.md rules 2, 5, 6):
//   - the @pict.edu domain is checked FIRST and a refusal is written to audit_logs;
//   - throttled per IP and per email (rate_limits), failing closed;
//   - generic answers: sign-up, sign-in and reset never reveal whether an address has an account;
//   - tokens are single use and stored hashed; a password reset ends every session of the account;
//   - an unverified address cannot sign in.
import { evaluateAccess } from './access.js';
import { writeAudit } from './audit.js';
import {
  emailLink,
  existingAccountMessage,
  appOrigin,
  resetMessage,
  sendEmail,
  verificationMessage,
} from './email.js';
import { adminEmails, allowedDomain, isAllowedEmail, normaliseEmail } from './domain.js';
import { checkPasswordPolicy, hashPassword, PASSWORD_PROBLEM_TEXT, verifyPassword } from './password.js';
import { checkRateLimits } from './rateLimit.js';
import { createDbSession } from './session.js';
import { issueEmailToken, peekEmailToken, redeemEmailToken } from './tokens.js';
import {
  createCredentialsUser,
  findUserByEmail,
  markEmailVerified,
  recordLogin,
  replaceUnverifiedPassword,
  setPasswordAndVerify,
} from './users.js';

/** @typedef {{ status: number, body: Record<string, unknown>, headers?: Record<string, string>, session?: { sessionToken: string, expires: Date } }} FlowResult */

const GENERIC_SIGNUP =
  'If that address can be used, we have sent a confirmation email. Open the link in it to finish creating your account.';
const GENERIC_FORGOT = 'If that address has an account, we have sent a link to choose a new password.';
const BAD_LOGIN = 'Invalid email or password.';

/**
 * Why an email send failed, for the log. Only OUR messages ("email is not configured", "email provider answered HTTP 403") pass; anything
 * else is reduced to its class name, so an address or a key can never reach a log through an error text.
 * @param {unknown} err
 */
function safeReason(err) {
  const m = err instanceof Error ? err.message : '';
  return /^(email is not configured|email provider answered HTTP \d{3}|Missing required environment variable [A-Z_]+)$/.test(
    m,
  )
    ? m
    : 'other';
}

/** @param {number} status @param {string} error @param {string} message @param {Record<string, unknown>} [extra] @returns {FlowResult} */
const fail = (status, error, message, extra = {}) => ({
  status,
  body: { ok: false, error, message, ...extra },
});
/** @param {string} message @returns {FlowResult} */
const ok = (message) => ({ status: 200, body: { ok: true, message } });
/** @param {number} retryAfterSeconds @returns {FlowResult} */
const limited = (retryAfterSeconds) => ({
  ...fail(429, 'rate_limited', 'Too many attempts. Please wait a while and try again.'),
  headers: { 'Retry-After': String(retryAfterSeconds) },
});

/**
 * @typedef {{ db: import('mongodb').Db, ip: string, now?: Date, env?: Record<string, string | undefined>,
 *   send?: typeof sendEmail }} Ctx
 */

// ---------------------------------------------------------------------------------------------------------- sign up
/**
 * @param {Ctx & { email: unknown, password: unknown }} c
 * @returns {Promise<FlowResult>}
 */
export async function signupFlow({
  db,
  ip,
  email: rawEmail,
  password,
  now = new Date(),
  env = process.env,
  send = sendEmail,
}) {
  const email = normaliseEmail(rawEmail);
  if (email === null) return fail(400, 'invalid_email', 'Enter a valid email address.');

  const rate = await checkRateLimits(db, 'signup', { ip, email }, now.getTime());
  if (!rate.allowed) {
    await writeAudit(db, {
      action: 'login_rejected',
      target: email,
      meta: { via: 'signup', reason: 'rate_limited' },
      ip,
    });
    return limited(rate.retryAfterSeconds);
  }

  // The domain rule, first and explicit (it says nothing about whether any account exists).
  if (!isAllowedEmail(email, { domain: allowedDomain(env) })) {
    await writeAudit(db, { action: 'login_rejected_domain', target: email, meta: { via: 'signup' }, ip });
    return fail(403, 'domain_not_allowed', `Only @${allowedDomain(env)} addresses can sign up.`);
  }

  const policy = checkPasswordPolicy(password, email);
  if (!policy.ok) {
    return fail(400, 'weak_password', PASSWORD_PROBLEM_TEXT[policy.problems[0]], {
      problems: policy.problems,
    });
  }
  // Hashed before looking anything up, so the work (and the time) is the same whether or not the address is taken.
  const passwordHash = await hashPassword(/** @type {string} */ (password));

  try {
    let user = await findUserByEmail(db, email);
    if (!user) {
      const created = await createCredentialsUser(db, { email, passwordHash, now });
      user = created ? { _id: created._id, emailVerified: null } : await findUserByEmail(db, email);
    } else if (!user.emailVerified) {
      await replaceUnverifiedPassword(db, user._id, passwordHash); // the same person signing up again
    }
    if (!user) return ok(GENERIC_SIGNUP);

    if (!user.emailVerified) {
      const token = await issueEmailToken(db, { userId: user._id, email, type: 'verify_email', now });
      await send({ to: email, ...verificationMessage(emailLink('verify-email', token, env)) }, env);
    } else {
      await send({ to: email, ...existingAccountMessage(appOrigin(env)) }, env);
    }
    await writeAudit(db, { action: 'signup', userId: user._id, target: email, meta: {}, ip });
    return ok(GENERIC_SIGNUP);
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'signup_failed', error: err?.name ?? 'Error', reason: safeReason(err) }),
    );
    return fail(
      503,
      'unavailable',
      'We could not send the confirmation email just now. Please try again later.',
    );
  }
}

// ----------------------------------------------------------------------------------------------------- verify email
/**
 * @param {Ctx & { token: unknown }} c
 * @returns {Promise<FlowResult>}
 */
export async function verifyEmailFlow({ db, ip, token, now = new Date() }) {
  const rate = await checkRateLimits(db, 'verify', { ip }, now.getTime());
  if (!rate.allowed) return limited(rate.retryAfterSeconds);
  const record = await redeemEmailToken(db, token, 'verify_email', now);
  if (!record)
    return fail(400, 'invalid_token', 'This link is invalid or has expired. Sign up again to get a new one.');
  await markEmailVerified(db, record.userId, now);
  await writeAudit(db, {
    action: 'email_verified',
    userId: record.userId,
    target: record.email,
    meta: {},
    ip,
  });
  return ok('Your email is confirmed. You can sign in now.');
}

// --------------------------------------------------------------------------------------------------------- sign in
/**
 * @param {Ctx & { email: unknown, password: unknown }} c
 * @returns {Promise<FlowResult>}
 */
export async function loginFlow({ db, ip, email: rawEmail, password, now = new Date(), env = process.env }) {
  const email = normaliseEmail(rawEmail);
  const rate = await checkRateLimits(db, 'login', { ip, email }, now.getTime());
  if (!rate.allowed) {
    await writeAudit(db, {
      action: 'login_rejected',
      target: email ?? 'invalid',
      meta: { reason: 'rate_limited' },
      ip,
    });
    return limited(rate.retryAfterSeconds);
  }
  if (email === null || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    await verifyPassword('x', null); // the same work as a real attempt
    return fail(401, 'invalid_credentials', BAD_LOGIN);
  }

  if (!isAllowedEmail(email, { domain: allowedDomain(env) })) {
    await verifyPassword(password, null);
    await writeAudit(db, { action: 'login_rejected_domain', target: email, meta: { via: 'password' }, ip });
    return fail(401, 'invalid_credentials', BAD_LOGIN);
  }

  const user = await findUserByEmail(db, email);
  const passwordOk = await verifyPassword(password, user?.passwordHash); // always runs a bcrypt comparison
  if (!user || !passwordOk) {
    await writeAudit(db, {
      action: 'login_rejected',
      userId: user?._id ?? null,
      target: email,
      meta: { reason: 'bad_credentials' },
      ip,
    });
    return fail(401, 'invalid_credentials', BAD_LOGIN);
  }

  // The password was right: now the account state decides (the same checks `requireUser` makes on every request).
  const access = evaluateAccess(user, { domain: allowedDomain(env), admins: adminEmails(env) });
  if (!access.ok) {
    await writeAudit(db, {
      action: 'login_rejected',
      userId: user._id,
      target: email,
      meta: { reason: access.code },
      ip,
    });
    if (access.code === 'email_not_verified') {
      return fail(
        403,
        'email_not_verified',
        'Confirm your email first: open the link we sent you when you signed up.',
      );
    }
    if (access.code === 'account_disabled')
      return fail(403, 'account_disabled', 'This account has been disabled.');
    return fail(401, 'invalid_credentials', BAD_LOGIN);
  }

  const session = await createDbSession(db, user._id, now);
  await recordLogin(db, user._id, now);
  await writeAudit(db, {
    action: 'login',
    userId: user._id,
    target: email,
    meta: { provider: 'password' },
    ip,
  });
  return { status: 200, body: { ok: true }, session };
}

// ---------------------------------------------------------------------------------------------------- forgot password
/**
 * @param {Ctx & { email: unknown }} c
 * @returns {Promise<FlowResult>}
 */
export async function forgotPasswordFlow({
  db,
  ip,
  email: rawEmail,
  now = new Date(),
  env = process.env,
  send = sendEmail,
}) {
  const email = normaliseEmail(rawEmail);
  if (email === null) return fail(400, 'invalid_email', 'Enter a valid email address.');
  const rate = await checkRateLimits(db, 'forgot', { ip, email }, now.getTime());
  if (!rate.allowed) return limited(rate.retryAfterSeconds);

  try {
    if (isAllowedEmail(email, { domain: allowedDomain(env) })) {
      const user = await findUserByEmail(db, email);
      if (user && user.disabled !== true) {
        const token = await issueEmailToken(db, { userId: user._id, email, type: 'reset_password', now });
        await send({ to: email, ...resetMessage(emailLink('reset-password', token, env)) }, env);
        await writeAudit(db, {
          action: 'password_reset_requested',
          userId: user._id,
          target: email,
          meta: {},
          ip,
        });
      }
    }
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'forgot_failed', error: err?.name ?? 'Error', reason: safeReason(err) }),
    );
    return fail(503, 'unavailable', 'We could not send the email just now. Please try again later.');
  }
  return ok(GENERIC_FORGOT);
}

// ----------------------------------------------------------------------------------------------------- reset password
/**
 * @param {Ctx & { token: unknown, password: unknown }} c
 * @returns {Promise<FlowResult>}
 */
export async function resetPasswordFlow({ db, ip, token, password, now = new Date() }) {
  const rate = await checkRateLimits(db, 'reset', { ip }, now.getTime());
  if (!rate.allowed) return limited(rate.retryAfterSeconds);

  const peek = await peekEmailToken(db, token, 'reset_password', now);
  if (!peek) return fail(400, 'invalid_token', 'This link is invalid or has expired. Ask for a new one.');
  const policy = checkPasswordPolicy(password, peek.email);
  if (!policy.ok)
    return fail(400, 'weak_password', PASSWORD_PROBLEM_TEXT[policy.problems[0]], {
      problems: policy.problems,
    });

  const passwordHash = await hashPassword(/** @type {string} */ (password));
  const record = await redeemEmailToken(db, token, 'reset_password', now); // single use: the loser of a race gets null
  if (!record) return fail(400, 'invalid_token', 'This link is invalid or has expired. Ask for a new one.');
  await setPasswordAndVerify(db, record.userId, { passwordHash, now });
  await writeAudit(db, {
    action: 'password_reset',
    userId: record.userId,
    target: record.email,
    meta: {},
    ip,
  });
  return ok('Your password has been changed. Sign in with the new password.');
}
