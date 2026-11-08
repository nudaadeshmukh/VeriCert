// Parsing of NPTEL's verification pages. PURE: strings in, data out, no I/O.
// The shapes are the ones recorded in NOTES.md §2 (observed 2026-11-06):
//
//   Shape A  nptel.ac.in/verify/<ID>   → 302 → beta.nptel.ac.in/verify/<ID>
//            A page whose data sits in a VISUALLY HIDDEN block (`div.sr`: <h1> name, <p> course ·
//            session · institute, <dl> with "Final score" and "Status") and a link to
//            /verify/<ID>/certificate.pdf. The marks are NOT in the HTML.
//   Shape B  nptel.ac.in/noc/E_Certificate/<ID>   → a wrapper with an <iframe> to
//            archive.nptel.ac.in/noc/E_Certificate/<ID> → 302 → /noc/Ecertificate/?q=<ID> → a
//            landing page with one RELATIVE link to the PDF. Nothing but the link is in the HTML.
//
// That hidden block is the fragile part: if NPTEL redesigns it, these functions return an error
// with a specific code (`source_format_changed`), never a guess (CLAUDE.md rules 6 and 11).
import { isAllowedNptelUrl } from '../extract/parse.js';

/** @typedef {{ code: string, message: string }} SourceParseError */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Minimal HTML entity decoding and tag stripping for short text snippets.
 * @param {string} s
 */
export function textOf(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * First `href` of an `<a>` whose target ends in `.pdf` (quoted or unquoted attribute).
 * @param {string} html
 * @returns {string | null}
 */
function findPdfHref(html) {
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of html.matchAll(re)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (/\.pdf(?:[?#].*)?$/i.test(href)) return href;
  }
  return null;
}

/**
 * Resolve a link against the page it came from and require it to be allowlisted.
 * @param {string} href
 * @param {string} base
 * @returns {URL | null}
 */
function resolveAllowed(href, base) {
  try {
    const u = new URL(href, base);
    return isAllowedNptelUrl(u) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Shape A: the verification page.
 *
 * @param {string} html
 * @param {string} pageUrl the URL the HTML was served from (after redirects)
 * @param {string} certificateId the ID from the QR code; the PDF link must carry the same one
 * @returns {{ name: string | null, course: string | null, total: number | null, status: string | null,
 *   pdfUrl: string, error?: undefined } | { error: SourceParseError }}
 */
export function parseVerifyPage(html, pageUrl, certificateId) {
  const href = findPdfHref(html);
  if (!href) {
    return {
      error: {
        code: 'source_format_changed',
        message: 'The verification page has no link to the certificate PDF',
      },
    };
  }
  const pdf = resolveAllowed(href, pageUrl);
  if (!pdf) {
    return {
      error: { code: 'source_format_changed', message: 'The certificate PDF link is not an NPTEL URL' },
    };
  }
  const m = /^\/verify\/([A-Za-z0-9-]{6,64})\/certificate\.pdf$/.exec(pdf.pathname);
  if (!m) {
    return {
      error: { code: 'source_format_changed', message: 'The certificate PDF link has an unexpected path' },
    };
  }
  if (m[1] !== certificateId) {
    return {
      error: {
        code: 'source_mismatch',
        message: 'The certificate PDF link is for a different certificate than the QR code',
      },
    };
  }

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const name = h1 ? textOf(h1[1]) || null : null;
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  // "Course name · SESSION · Institute": the course is everything before the first " · ".
  const course = p ? textOf(p[1]).split(' · ')[0].trim() || null : null;

  /** @type {Map<string, string>} */
  const dl = new Map();
  for (const d of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    dl.set(textOf(d[1]).toLowerCase(), textOf(d[2]));
  }
  const score = /^(\d+(?:\.\d+)?)\s*\/\s*100$/.exec(dl.get('final score') ?? '');
  const total = score ? Number(score[1]) : null;
  const status = dl.get('status') ?? null;

  return { name, course, total, status, pdfUrl: pdf.href };
}

/**
 * Shape B, step 1: the wrapper page's iframe.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @param {string} certificateId
 * @returns {{ iframeUrl: string, error?: undefined } | { error: SourceParseError }}
 */
export function parseEcertWrapper(html, pageUrl, certificateId) {
  const m = /<iframe\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html);
  const src = m?.[1] ?? m?.[2];
  if (!src) {
    return {
      error: { code: 'source_format_changed', message: 'The certificate page has no embedded viewer' },
    };
  }
  const u = resolveAllowed(src, pageUrl);
  if (!u)
    return { error: { code: 'source_format_changed', message: 'The embedded viewer is not an NPTEL URL' } };
  const path = /^\/noc\/E_Certificate\/([A-Za-z0-9_-]{6,64})\/?$/i.exec(u.pathname);
  if (!path) {
    return {
      error: { code: 'source_format_changed', message: 'The embedded viewer has an unexpected path' },
    };
  }
  if (path[1] !== certificateId) {
    return {
      error: {
        code: 'source_mismatch',
        message: 'The embedded viewer is for a different certificate than the QR code',
      },
    };
  }
  return { iframeUrl: u.href };
}

/**
 * Shape B, step 2: the archive landing page, which holds one relative link to the PDF.
 *
 * @param {string} html
 * @param {string} pageUrl the landing page URL after redirects (the link is relative to it)
 * @param {string} certificateId
 * @returns {{ pdfUrl: string, error?: undefined } | { error: SourceParseError }}
 */
export function parseArchiveLanding(html, pageUrl, certificateId) {
  const href = findPdfHref(html);
  if (!href) {
    return {
      error: {
        code: 'source_format_changed',
        message: 'The certificate page has no link to the certificate PDF',
      },
    };
  }
  const pdf = resolveAllowed(href, pageUrl);
  if (!pdf) {
    return {
      error: { code: 'source_format_changed', message: 'The certificate PDF link is not an NPTEL URL' },
    };
  }
  // …/content/noc/NOC25/SEM1/Ecertificates/110/noc25-mg18/Course/<ID>.pdf
  const m = /^\/content\/noc\/[A-Za-z0-9_./-]+\/([A-Za-z0-9_-]{6,64})\.pdf$/i.exec(pdf.pathname);
  if (!m || pdf.pathname.includes('..')) {
    return {
      error: { code: 'source_format_changed', message: 'The certificate PDF link has an unexpected path' },
    };
  }
  if (m[1] !== certificateId) {
    return {
      error: {
        code: 'source_mismatch',
        message: 'The certificate PDF is for a different certificate than the QR code',
      },
    };
  }
  return { pdfUrl: pdf.href };
}
