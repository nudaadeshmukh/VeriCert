// Server-side fetch of NPTEL pages and PDFs (CLAUDE.md rule 3).
//
// - ALLOWLIST: only https on nptel.ac.in / *.nptel.ac.in, port 443, no credentials. Checked on the
//   first URL and again on EVERY redirect hop (`redirect: "manual"`, at most 5 hops followed by us).
//   The check is `isAllowedNptelUrl` from the shared parse.js (hostname, not host).
// - Browser-like headers, ONE retry (on a 5xx, a network error or an attempt timeout), an 8 s
//   timeout per attempt and 20 s in total. Nothing else: no captcha solving, no proxies, no
//   evasion. If NPTEL refuses us we report it (see the plan's Contingency), we do not work around it.
// - Response bodies are size-capped while streaming.
//
// `fetch` is injectable so tests run without a network.
import { isAllowedNptelUrl } from '../extract/parse.js';

export const LIMITS = Object.freeze({
  attemptMs: 8000,
  totalMs: 20_000,
  maxHops: 5,
  maxAttempts: 2, // the first try plus one retry
  maxHtmlBytes: 256 * 1024,
  maxPdfBytes: 8 * 1024 * 1024,
});

/** Headers a normal desktop Chrome sends for a page load (NOTES.md §2.3). */
export const BROWSER_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
});

/**
 * Failure codes: `url_not_allowed`, `too_many_redirects`, `bad_redirect`, `source_not_found`,
 * `source_http_error`, `source_unreachable`, `source_timeout`, `source_too_large`.
 */
export class SourceFetchError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'SourceFetchError';
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Read a response body, refusing more than `maxBytes`.
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>}
 */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new SourceFetchError('source_too_large', `Response is ${declared} bytes, the limit is ${maxBytes}`);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SourceFetchError(
        'source_too_large',
        `Response is larger than the limit of ${maxBytes} bytes`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * One attempt: follow redirects by hand, checking every hop.
 * @param {string} startUrl
 * @param {{ fetchImpl: typeof fetch, headers: Record<string, string>, maxBytes: number,
 *   signal: AbortSignal, maxHops: number }} o
 */
async function attempt(startUrl, { fetchImpl, headers, maxBytes, signal, maxHops }) {
  /** @type {string[]} */
  const hops = [];
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      throw hop === 0
        ? new SourceFetchError('url_not_allowed', 'Not a valid URL')
        : new SourceFetchError('bad_redirect', 'A redirect pointed at something that is not a URL');
    }
    // THE allowlist check: first URL and every redirect target.
    if (!isAllowedNptelUrl(u)) {
      throw new SourceFetchError(
        'url_not_allowed',
        `Refusing to fetch ${u.protocol}//${u.hostname}: not on the NPTEL allowlist`,
        {
          hostname: u.hostname,
        },
      );
    }
    hops.push(u.href);
    const res = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', headers, signal });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location)
        throw new SourceFetchError('bad_redirect', `HTTP ${res.status} without a Location header`);
      if (hop >= maxHops) {
        throw new SourceFetchError('too_many_redirects', `More than ${maxHops} redirects`);
      }
      try {
        current = new URL(location, u).href; // relative Locations resolve against the current URL
      } catch {
        throw new SourceFetchError('bad_redirect', 'A redirect Location header is not a valid URL');
      }
      continue;
    }
    if (res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      throw new SourceFetchError('source_unreachable', `NPTEL answered HTTP ${res.status}`, {
        status: res.status,
        retryable: true,
      });
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      throw new SourceFetchError('source_not_found', `NPTEL answered HTTP ${res.status}`, {
        status: res.status,
      });
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {});
      throw new SourceFetchError('source_http_error', `NPTEL answered HTTP ${res.status}`, {
        status: res.status,
      });
    }
    const body = await readCapped(res, maxBytes);
    return {
      status: res.status,
      url: u.href,
      hops,
      contentType: res.headers.get('content-type') ?? '',
      body,
    };
  }
}

/**
 * Fetch an NPTEL URL.
 *
 * @param {string} url
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   accept?: string,
 *   maxBytes?: number,
 *   deadline?: number,          absolute `Date.now()` value by which everything must be done
 *   attemptMs?: number,
 *   totalMs?: number,
 *   maxHops?: number,
 *   maxAttempts?: number,
 * }} [opts]
 * @returns {Promise<{ status: number, url: string, hops: string[], contentType: string,
 *   body: Uint8Array, attempts: number }>}
 */
export async function fetchNptel(url, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    accept,
    maxBytes = LIMITS.maxHtmlBytes,
    attemptMs = LIMITS.attemptMs,
    totalMs = LIMITS.totalMs,
    maxHops = LIMITS.maxHops,
    maxAttempts = LIMITS.maxAttempts,
  } = opts;
  const deadline = opts.deadline ?? Date.now() + totalMs;
  const headers = { ...BROWSER_HEADERS, ...(accept ? { Accept: accept } : {}) };

  /** @type {unknown} */
  let lastError;
  for (let n = 1; n <= maxAttempts; n++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SourceFetchError(
        'source_timeout',
        `The ${Math.round(totalMs / 1000)} s overall limit was reached`,
      );
    }
    const signal = AbortSignal.timeout(Math.min(attemptMs, remaining));
    try {
      const result = await attempt(url, { fetchImpl, headers, maxBytes, signal, maxHops });
      return { ...result, attempts: n };
    } catch (err) {
      lastError = err;
      if (err instanceof SourceFetchError) {
        // Only a 5xx is worth a second try; the rest (not allowed, 404, too large...) will not change.
        if (err.extra.retryable) continue;
        throw err;
      }
      // A thrown non-SourceFetchError: a timeout (abort) or a network error. Both get the retry.
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError' || signal.aborted;
      if (timedOut && deadline - Date.now() <= 0) {
        throw new SourceFetchError(
          'source_timeout',
          `The ${Math.round(totalMs / 1000)} s overall limit was reached`,
        );
      }
      lastError = new SourceFetchError(
        timedOut ? 'source_timeout' : 'source_unreachable',
        timedOut
          ? `NPTEL did not answer within ${Math.round(attemptMs / 1000)} s`
          : 'Could not connect to NPTEL',
        { retryable: true, cause: err?.name ?? 'Error' },
      );
    }
  }
  throw lastError instanceof SourceFetchError
    ? lastError
    : new SourceFetchError('source_unreachable', 'Could not reach NPTEL');
}
