// verifySource(url): given the URL from a certificate's QR code, return NPTEL's authoritative
// values, read from NPTEL's own certificate PDF.
//
// Result: { source: { name, course, assignment, exam, total } | null, error?, message?, meta }
//   - `error` is a code string when the source could not be established; `source` still carries
//     whatever was read (for example the name) so the caller can show it.
//   - The PDF is read here and NEVER returned (Vercel's 4.5 MB response limit, and rule 1's spirit).
//
// Parsing of the PDF's text is `parseCertificateText` from src/lib/extract/parse.js: the same
// function that reads an uploaded certificate. There is no second parser.
import { parseCertificateText, parseVerifyUrl } from '../extract/parse.js';
import { fetchNptel, LIMITS, SourceFetchError } from './fetchSource.js';
import { parseArchiveLanding, parseEcertWrapper, parseVerifyPage } from './parseSource.js';
import { readSourcePdf } from './readPdf.js';
import { createDeduper } from './dedupe.js';

export { createDeduper };

/**
 * Error codes: `invalid_url`, `url_not_allowed`, `unsupported_url_shape` (request problems);
 * `source_unreachable`, `source_timeout`, `source_not_found`, `source_http_error`,
 * `too_many_redirects`, `bad_redirect`, `source_too_large` (NPTEL could not be read);
 * `source_format_changed`, `source_mismatch`, `source_not_live`, `source_unreadable`,
 * `source_parse_failed` (NPTEL answered, but not with something we can trust);
 * `internal_error` (our bug, never NPTEL's).
 *
 * @typedef {{ name: string | null, course: string | null, assignment: number | null,
 *   exam: number | null, total: number | null }} Source
 * `meta.requests` counts fetch ATTEMPTS (each one follows its own redirects), not HTTP requests.
 *
 * @typedef {{ source: Source | null, error?: string, message?: string,
 *   meta: { shape?: string, ms: number, requests?: number, details?: string[], errorName?: string, status?: string } }} VerifyResult
 */

const PDF_ACCEPT = 'application/pdf,*/*;q=0.8';
const URL_ERROR = {
  qr_not_url: 'invalid_url',
  qr_unsupported_scheme: 'url_not_allowed',
  qr_not_nptel: 'url_not_allowed',
  qr_unknown_shape: 'unsupported_url_shape',
};

/**
 * @param {string} url the QR code's URL
 * @param {{ fetchImpl?: typeof fetch, cache?: ReturnType<typeof createDeduper>,
 *   totalMs?: number, attemptMs?: number, now?: () => number }} [opts]
 * @returns {Promise<VerifyResult>}
 */
export async function verifySource(url, opts = {}) {
  const parsed = parseVerifyUrl(url);
  if (parsed.error) {
    return {
      source: null,
      error: URL_ERROR[parsed.error.code] ?? 'invalid_url',
      // parseVerifyUrl words its messages for a QR payload; this is an API caller's URL.
      message: parsed.error.message
        .replace(/^The QR (code )?(URL )?/, 'The URL ')
        .replace('The URL does not contain a URL', 'Not a valid URL'),
      meta: { ms: 0 },
    };
  }
  // The batch cache is keyed by the normalised URL, so `…/verify/ID/` and `…/verify/ID` share one fetch.
  return opts.cache ? opts.cache.run(parsed.url, () => run(parsed, opts)) : run(parsed, opts);
}

/**
 * @param {{ url: string, shape: 'verify' | 'e_certificate', certificateId: string }} parsed
 * @param {NonNullable<Parameters<typeof verifySource>[1]>} opts
 * @returns {Promise<VerifyResult>}
 */
async function run({ url, shape, certificateId }, opts) {
  const start = Date.now();
  const totalMs = opts.totalMs ?? LIMITS.totalMs;
  const deadline = start + totalMs;
  let requests = 0;
  /** @param {string} u @param {{ accept?: string, maxBytes?: number }} [o] */
  const get = async (u, o = {}) => {
    const r = await fetchNptel(u, {
      fetchImpl: opts.fetchImpl,
      attemptMs: opts.attemptMs,
      totalMs,
      deadline,
      ...o,
    });
    requests += r.attempts;
    return r;
  };
  const meta = () => ({ shape, ms: Date.now() - start, requests });
  /** @param {string} error @param {string} message @param {Source | null} [source] @param {string[]} [details] */
  const fail = (error, message, source = null, details) => ({
    source,
    error,
    message,
    meta: { ...meta(), ...(details ? { details } : {}) },
  });
  const html = (r) => new TextDecoder('utf-8', { fatal: false }).decode(r.body);

  /** @type {{ name: string | null, course: string | null, total: number | null } | null} */
  let page = null;
  /** @type {string} */
  let pdfUrl;

  try {
    if (shape === 'verify') {
      const r = await get(url);
      const p = parseVerifyPage(html(r), r.url, certificateId);
      if (p.error) return fail(p.error.code, p.error.message);
      // A status other than LIVE (only "LIVE" has been observed) cannot be called verified.
      if (p.status !== null && p.status.toUpperCase() !== 'LIVE') {
        const notLive = fail('source_not_live', `NPTEL reports this certificate's status as "${p.status}"`);
        notLive.meta.status = p.status;
        return notLive;
      }
      page = { name: p.name, course: p.course, total: p.total };
      pdfUrl = p.pdfUrl;
    } else {
      const wrapper = await get(url);
      const w = parseEcertWrapper(html(wrapper), wrapper.url, certificateId);
      if (w.error) return fail(w.error.code, w.error.message);
      const landing = await get(w.iframeUrl); // 302 to /noc/Ecertificate/?q=<ID>, followed (and checked) hop by hop
      const l = parseArchiveLanding(html(landing), landing.url, certificateId);
      if (l.error) return fail(l.error.code, l.error.message);
      pdfUrl = l.pdfUrl;
    }

    const pdf = await get(pdfUrl, { accept: PDF_ACCEPT, maxBytes: LIMITS.maxPdfBytes });
    if (!(pdf.body.length > 4 && String.fromCharCode(...pdf.body.slice(0, 5)) === '%PDF-')) {
      return fail('source_format_changed', 'NPTEL served something other than a PDF at the certificate link');
    }

    let text;
    try {
      text = await readSourcePdf(pdf.body);
    } catch {
      return fail('source_unreadable', "NPTEL's certificate PDF could not be opened");
    }
    if (text.items.length === 0) {
      return fail(
        'source_unreadable',
        "NPTEL's certificate PDF has no text layer (no OCR on the server in v1)",
      );
    }

    const c = parseCertificateText(text.items, { page: text.page });
    /** @type {Source} */
    const source = {
      name: c.name ?? page?.name ?? null,
      course: c.course ?? page?.course ?? null,
      assignment: c.assignment,
      exam: c.exam,
      total: c.total ?? page?.total ?? null,
    };
    if (source.assignment === null || source.exam === null) {
      return fail(
        'source_parse_failed',
        "The marks could not be read from NPTEL's certificate PDF",
        source,
        c.errors.map((e) => `${e.code}${e.field ? `:${e.field}` : ''}`),
      );
    }
    return { source, meta: meta() };
  } catch (err) {
    if (err instanceof SourceFetchError) return fail(err.code, err.message);
    // Anything else is OUR bug, not NPTEL's. No internals in the message; the class name goes in
    // `meta` so the route can log it.
    const result = fail('internal_error', 'Unexpected error while verifying');
    result.meta.errorName = err?.name ?? 'Error';
    return result;
  }
}
