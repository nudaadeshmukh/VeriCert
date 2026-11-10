// Small helpers for the credentials API routes.
import { NextResponse } from 'next/server';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * @param {Record<string, unknown>} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
export function json(body, status = 200, headers = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** @param {string} error machine code @param {string} message text for the person @param {number} status */
export function jsonError(error, message, status, headers = {}) {
  return json({ ok: false, error, message }, status, headers);
}

/**
 * Refuse cross-site requests: a browser always sends `Origin` on a cross-site POST, and it must be our own origin. Requests with no
 * `Origin` (curl, the smoke script) are not browsers acting for a victim and are allowed. Together with SameSite=Lax cookies this
 * stops login CSRF and cross-site sign-up spam.
 * @param {Request} request
 * @returns {Response | null} a refusal, or null to continue
 */
export function rejectCrossSite(request) {
  const origin = request.headers.get('origin');
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).origin === new URL(request.url).origin;
    } catch {
      ok = false;
    }
    if (!ok) return jsonError('forbidden', 'Cross-site request refused.', 403);
  }
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return jsonError('unsupported_media_type', 'Send JSON.', 415);
  }
  return null;
}

/**
 * Read a small JSON object body.
 * @param {Request} request
 * @param {number} [maxBytes]
 * @returns {Promise<{ ok: true, body: Record<string, unknown> } | { ok: false, response: Response }>}
 */
export async function readJsonBody(request, maxBytes = 4096) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes)
    return { ok: false, response: jsonError('payload_too_large', 'Request too large.', 413) };
  const text = await request.text();
  if (text.length > maxBytes)
    return { ok: false, response: jsonError('payload_too_large', 'Request too large.', 413) };
  try {
    const body = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: jsonError('invalid_request', 'The request body must be a JSON object.', 400),
    };
  }
}

/** Seconds → a 429 response with `Retry-After`. @param {number} retryAfterSeconds */
export function tooManyRequests(retryAfterSeconds) {
  return jsonError('rate_limited', 'Too many attempts. Please wait a while and try again.', 429, {
    'Retry-After': String(retryAfterSeconds),
  });
}
