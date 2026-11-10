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
// Verification verdict (Phase 4's tampering verdict consumes them). A text-layer difference fails; an OCR'd one fails
// only if the OCR was confident, agreed with itself and the texts are clearly different (config.js), and is otherwise
// "could not be confirmed – check manually". The detail always shows both names side by side.
//
// Precedence (decided by the user, Phase 3 review): a differing mark beats a missing one, so the order is
// not-live, then any difference (Unsuccessful), then any missing value (Error), then Successful.
import { normalizeText } from './extract/parse.js';
import {
  OCR_TEXT_MIN_CONFIDENCE,
  OCR_TEXT_MIN_DIFFERENCE_RATIO,
  OCR_TEXT_MIN_EDIT_DISTANCE,
} from './tamper/config.js';

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
 *   exam?: number | null, source?: 'text_layer' | 'ocr', ocrFields?: string[],
 *   ocrConfidence?: { name?: number, course?: number }, ocrAgreement?: { name?: boolean, course?: boolean },
 * }} CertificateValues  as read from the upload (extractCertificate's result)
 * @typedef {{ source: { name: string | null, course: string | null, assignment: number | null,
 *   exam: number | null } | null, error?: string, message?: string,
 *   meta?: { status?: string } }} SourceResult  from verifySource()
 * @typedef {{ id: string, outcome: 'pass' | 'fail' | 'not_confirmed' | 'not_applicable', detail: string }} Check
 */

/**
 * Edit distance (insertions, deletions, substitutions) between two strings, by code points (Unicode-safe).
 * @param {string} a
 * @param {string} b
 */
export function editDistance(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length];
}

/**
 * Edit distance / length of the longer string.
 * @param {string} a
 * @param {string} b
 */
export function differenceRatio(a, b) {
  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  return longest === 0 ? 0 : editDistance(a, b) / longest;
}

/**
 * May OCR text CONTRADICT another source? Only if the two OCR reads agreed, the lower confidence is high, and the texts are
 * clearly different (config.js, with the evidence). Anything else is "not confirmed", never a mismatch (rule 6).
 * @param {string} a normalised
 * @param {string} b normalised
 * @param {{ confidence?: number, agreed?: boolean }} ocr
 * @returns {{ clearlyDifferent: boolean, why?: string }}
 */
export function ocrTextContradicts(a, b, { confidence, agreed }) {
  if (agreed !== true) return { clearlyDifferent: false, why: 'the two OCR reads did not agree' };
  if (typeof confidence !== 'number' || confidence < OCR_TEXT_MIN_CONFIDENCE) {
    return { clearlyDifferent: false, why: 'OCR confidence is low' };
  }
  if (
    editDistance(a, b) < OCR_TEXT_MIN_EDIT_DISTANCE ||
    differenceRatio(a, b) < OCR_TEXT_MIN_DIFFERENCE_RATIO
  ) {
    return { clearlyDifferent: false, why: 'the difference is small enough to be an OCR slip' };
  }
  return { clearlyDifferent: true };
}

/**
 * The name / course check. The detail ALWAYS shows both texts side by side, whatever the outcome.
 *
 *  - equal after normalisation → pass
 *  - text layer, different     → fail
 *  - OCR, different            → fail only if `ocrTextContradicts` (two reads agree, confident, clearly different);
 *                                otherwise not_confirmed: "<Label> could not be confirmed – check manually"
 *  - either side missing       → not_confirmed
 *
 * @param {string} id
 * @param {string} label
 * @param {string | null | undefined} cert
 * @param {string | null | undefined} src
 * @param {{ isOcr: boolean, confidence?: number, agreed?: boolean }} ocr provenance of the certificate's value
 * @returns {Check}
 */
function textCheck(id, label, cert, src, ocr) {
  const sideBySide = `Certificate: ${cert ? `"${cert}"` : '(not read)'} | NPTEL: ${src ? `"${src}"` : '(not available)'}`;
  const manual = `${label} could not be confirmed – check manually`;
  if (!cert || !src) return { id, outcome: 'not_confirmed', detail: `${manual}. ${sideBySide}` };
  const a = normalizeForCompare(cert);
  const b = normalizeForCompare(src);
  if (a === b) return { id, outcome: 'pass', detail: `${label} matches NPTEL. ${sideBySide}` };
  if (!ocr.isOcr)
    return { id, outcome: 'fail', detail: `${label} on the certificate differs from NPTEL's. ${sideBySide}` };
  const verdict = ocrTextContradicts(a, b, ocr);
  if (verdict.clearlyDifferent) {
    return {
      id,
      outcome: 'fail',
      detail: `${label} on the certificate clearly differs from NPTEL's (read by OCR: two reads agree, confidence ${ocr.confidence}). ${sideBySide}`,
    };
  }
  return { id, outcome: 'not_confirmed', detail: `${manual} (read by OCR; ${verdict.why}). ${sideBySide}` };
}

/**
 * @param {CertificateValues} cert
 * @param {SourceResult | null | undefined} result
 */
export function compareCertificate(cert, result) {
  const src = result?.source ?? null;
  /** Where one field's value came from, and how far OCR can be trusted for it. */
  const provenance = (/** @type {'name' | 'course'} */ field) => ({
    // Per field when the extractor says which fields came from OCR; otherwise the whole certificate's source.
    isOcr: cert.ocrFields ? cert.ocrFields.includes(field) : cert.source === 'ocr',
    confidence: cert.ocrConfidence?.[field],
    agreed: cert.ocrAgreement?.[field] === true,
  });

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
    textCheck('name_match', 'Name', cert.name, src?.name, provenance('name')),
    textCheck('course_match', 'Course', cert.course, src?.course, provenance('course')),
  ];
  return { verification, reason, marks, checks };
}
