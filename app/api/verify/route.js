// POST /api/verify  { url }  →  { source: { name, course, assignment, exam, total } | null,
//                                  error?, message?, meta: { shape, ms, requests } }
//
// TEMPORARILY UNAUTHENTICATED (Phase 3). It is reachable only where `isVerifyEndpointEnabled()` says
// so: local dev, or a Vercel Preview with VERIFY_DEV_ENDPOINT=1. Phase 5 removes that guard and adds
// `requireUser()`; see docs/progress.md.
//
// The server fetches only nptel.ac.in / *.nptel.ac.in (checked on every redirect hop), reads
// NPTEL's own certificate PDF and returns the parsed fields. It never returns the PDF.
import { NextResponse } from 'next/server';
import { createDeduper, verifySource } from '../../../src/lib/verify/index.js';
import { isVerifyEndpointEnabled } from '../../../src/lib/verify/guard.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Time budget inside verifySource is 20 s (8 s per attempt); the PDF parse adds well under a second.
// 30 s is above that and within Vercel Hobby's configurable maximum (60 s; 300 s with Fluid compute).
export const maxDuration = 30;

const MAX_BODY_BYTES = 2048;
const MAX_URL_LENGTH = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };
/** Problems with the request itself; everything else about NPTEL is a normal 200 with an `error` code. */
const CLIENT_ERRORS = new Set(['invalid_url', 'url_not_allowed', 'unsupported_url_shape']);

/** @param {string} error @param {string} message @param {number} status */
const reject = (error, message, status) =>
  NextResponse.json({ source: null, error, message, meta: { ms: 0 } }, { status, headers: NO_STORE });

export async function POST(request) {
  if (!isVerifyEndpointEnabled()) {
    return new NextResponse(null, { status: 404, headers: NO_STORE }); // pretend it does not exist
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return reject('invalid_request', 'Request body too large', 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reject('invalid_request', 'Request body too large', 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reject('invalid_request', 'Body must be JSON: { "url": "https://…" }', 400);
  }
  const url = body?.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
    return reject('invalid_request', 'Body must be { "url": "<NPTEL verification URL>" }', 400);
  }

  const result = await verifySource(url, { cache: createDeduper() });

  // Structured log without personal data: no URL (the certificate ID is a lookup key), no names.
  console.log(
    JSON.stringify({
      event: 'verify',
      ok: !result.error,
      error: result.error ?? null,
      shape: result.meta.shape ?? null,
      ms: result.meta.ms,
      requests: result.meta.requests ?? 0,
      ...(result.meta.errorName ? { errorName: result.meta.errorName } : {}),
    }),
  );

  const status = result.error && CLIENT_ERRORS.has(result.error) ? 400 : 200;
  return NextResponse.json(result, { status, headers: NO_STORE });
}
