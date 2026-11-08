// Comparing an uploaded certificate with NPTEL's source (CLAUDE.md "Result semantics", rule 6).
//
//   Verification  Successful    both marks equal the source (tolerance 0.01, decimals allowed)
//                 Unsuccessful  ANY mark present on both sides differs (a differing mark is proof of a
//                               mismatch, even if the other mark is missing), or NPTEL says the
//                               certificate is not live
//                 Error         nothing differs and a value is missing: certificate value unread,
//                               source unavailable or unparsed. The reason says which. (CSV-only: Error
//                               is written as Unsuccessful, with the reason in Remarks.)
//
// Name and course are compared after normalisation and recorded as CHECKS. They never change the
// Verification verdict (Phase 4's tampering verdict consumes them).
//
// Precedence (decided by the user, Phase 3 review): a differing mark beats a missing one, so the order is
// not-live, then any difference (Unsuccessful), then any missing value (Error), then Successful.
import { normalizeText } from './extract/parse.js';

/** Marks within this are equal (CLAUDE.md). Decimals are allowed, e.g. 22.5 and 61.88. */
export const MARK_TOLERANCE = 0.01;

/**
 * @param {number} a
 * @param {number} b
 */
export function marksEqual(a, b) {
  // 1e-9: 22.51 - 22.5 is 0.010000000000001563 in floating point and must still count as 0.01.
  return Math.abs(a - b) <= MARK_TOLERANCE + 1e-9;
}

/**
 * Key for comparing names and courses: NFC, case-folded, punctuation and dashes treated as
 * spaces, whitespace collapsed. Unicode-aware (`\p{L}\p{M}\p{N}`), so Devanagari combining marks
 * are kept.
 * @param {unknown} s
 */
export function normalizeForCompare(s) {
  return normalizeText(s)
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

const isNum = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @typedef {{ name?: string | null, course?: string | null, assignment?: number | null,
 *   exam?: number | null, source?: 'text_layer' | 'ocr' }} CertificateValues  as read from the upload
 * @typedef {{ source: { name: string | null, course: string | null, assignment: number | null,
 *   exam: number | null } | null, error?: string, message?: string,
 *   meta?: { status?: string } }} SourceResult  from verifySource()
 * @typedef {{ id: string, outcome: 'pass' | 'fail' | 'not_confirmed' | 'not_applicable', detail: string }} Check
 */

/**
 * @param {string} id
 * @param {string} label
 * @param {string | null | undefined} cert
 * @param {string | null | undefined} src
 * @param {boolean} certIsOcr
 * @returns {Check}
 */
function textCheck(id, label, cert, src, certIsOcr) {
  if (!cert) return { id, outcome: 'not_confirmed', detail: `${label} was not read from the certificate` };
  if (!src) return { id, outcome: 'not_confirmed', detail: `${label} is not available from NPTEL` };
  if (normalizeForCompare(cert) === normalizeForCompare(src)) {
    return { id, outcome: 'pass', detail: `${label} matches NPTEL after normalisation` };
  }
  if (certIsOcr) {
    // OCR can misread text; a different-looking OCR value is "not confirmed", never a mismatch.
    return {
      id,
      outcome: 'not_confirmed',
      detail: `${label} read by OCR ("${cert}") differs from NPTEL ("${src}"); OCR text is not treated as a mismatch`,
    };
  }
  return {
    id,
    outcome: 'fail',
    detail: `${label} on the certificate ("${cert}") differs from NPTEL ("${src}")`,
  };
}

/**
 * @param {CertificateValues} cert
 * @param {SourceResult | null | undefined} result
 */
export function compareCertificate(cert, result) {
  const src = result?.source ?? null;
  const certIsOcr = cert.source === 'ocr';

  /** @type {Record<'assignment' | 'exam', { certificate: number | null, source: number | null,
   *   outcome: 'match' | 'differ' | 'missing' }>} */
  const marks = { assignment: undefined, exam: undefined };
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const differ = [];
  for (const field of /** @type {const} */ (['assignment', 'exam'])) {
    const c = isNum(cert[field]) ? /** @type {number} */ (cert[field]) : null;
    const s = src && isNum(src[field]) ? src[field] : null;
    const outcome = c === null || s === null ? 'missing' : marksEqual(c, s) ? 'match' : 'differ';
    marks[field] = { certificate: c, source: s, outcome };
    const label = field === 'assignment' ? 'Assignment marks' : 'Exam marks';
    if (c === null) missing.push(`${label} could not be read from the certificate`);
    if (s === null) missing.push(`${label} are not available from NPTEL`);
    if (outcome === 'differ') differ.push(`${label} differ (certificate ${c}, NPTEL ${s})`);
  }

  /** @type {'Successful' | 'Unsuccessful' | 'Error'} */
  let verification;
  /** @type {string | null} */
  let reason = null;
  const why = result?.error ? ` (${result.error}${result.message ? `: ${result.message}` : ''})` : '';
  if (result?.error === 'source_not_live') {
    // NPTEL itself says the certificate is revoked, expired or otherwise not live: not verified.
    verification = 'Unsuccessful';
    reason = `Certificate not live on NPTEL (status: ${result.meta?.status ?? 'unknown'})`;
  } else if (differ.length > 0) {
    // A mark present on both sides that differs is proof of a mismatch, whatever else is missing.
    verification = 'Unsuccessful';
    reason = [...differ, ...missing].join('; ') + (missing.length > 0 ? why : '');
  } else if (missing.length > 0) {
    verification = 'Error';
    reason = missing.join('; ') + why;
  } else {
    verification = 'Successful';
  }

  /** @type {Check[]} */
  const checks = [
    textCheck('name_match', 'Name', cert.name, src?.name, certIsOcr),
    textCheck('course_match', 'Course', cert.course, src?.course, certIsOcr),
  ];
  return { verification, reason, marks, checks };
}
