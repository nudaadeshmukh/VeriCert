// Certificate text parsing. PURE: no browser APIs, no imports, no I/O. Phase 3's server code
// reuses this module for NPTEL's source PDF, so keep it that way.
//
// Facts this relies on (NOTES.md §1, §2): a certificate's text layer carries the name, the
// course, `n/25`, `n/75` and a roll number, with NO labels. Marks are therefore found by their
// `n/25` and `n/75` shape, and the name and course by their position above the marks row.
//
// Rule 6 (CLAUDE.md): a value that cannot be read is `null` plus an entry in `errors`. It is
// never guessed, and never silently treated as a match.

export const MAX_ASSIGNMENT = 25;
export const MAX_EXAM = 75;

/**
 * @typedef {{ code: string, field?: string, message: string }} ParseError
 * @typedef {{ str: string, x?: number, y: number, h?: number }} TextItem  y grows UPWARD (PDF convention)
 */

/**
 * NFC-normalise, drop zero-width space/BOM, collapse all whitespace (incl. no-break space) to
 * one space, trim. U+200C/U+200D (ZWNJ/ZWJ) are kept: they are meaningful in Devanagari.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[​﻿]/g, '')
    .replace(/[\s ]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------- marks

// OCR slips we tolerate in a numerator (CLAUDE.md / plan): O→0, l/I→1, S→5. `|` is read as 1.
const SLIP_DIGITS = { O: '0', o: '0', l: '1', I: '1', '|': '1', S: '5' };

/**
 * Convert a numerator token to a number, or null.
 * @param {string} token
 * @param {boolean} tolerant allow OCR slips and a comma as the decimal mark
 * @returns {number | null}
 */
export function parseMarkToken(token, tolerant = false) {
  let t = token.trim();
  if (tolerant) {
    // A token with no genuine digit at all ("S", "lO") is noise, not a mark.
    if (!/\d/.test(t)) return null;
    t = t.replace(/[OolI|S]/g, (c) => SLIP_DIGITS[c]).replace(',', '.');
  }
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const STRICT_RE = /(?<![A-Za-z0-9.,])(\d+(?:\.\d+)?)\s*\/\s*(25|75)(?![0-9A-Za-z])/g;
const TOLERANT_RE = /(?<![A-Za-z0-9.,])([0-9OolIS|]+(?:[.,][0-9OolIS|]+)?)\s*\/\s*([27][5S])(?![0-9A-Za-z])/g;

/**
 * Find `n/25` (assignment) and `n/75` (exam) in text.
 *
 * `tolerant: false` (text layer): digits only. `tolerant: true` (OCR output): also accepts
 * O→0, l/I→1, S→5 in the numerator, `2S`/`7S` as the denominator, and a comma decimal.
 * Spaces around the slash are accepted in both modes.
 *
 * Ranges are enforced: assignment 0–25, exam 0–75. Out of range is an error, not a clamp.
 * Two different candidates for one field is an error (`ambiguous_marks`), not "take the first".
 *
 * @param {string} text
 * @param {{ tolerant?: boolean }} [opts]
 * @returns {{ assignment: number | null, exam: number | null, errors: ParseError[] }}
 */
export function parseMarks(text, { tolerant = false } = {}) {
  const re = new RegExp((tolerant ? TOLERANT_RE : STRICT_RE).source, 'g');
  /** @type {{ assignment: Set<number>, exam: Set<number> }} */
  const found = { assignment: new Set(), exam: new Set() };
  /** @type {ParseError[]} */
  const errors = [];
  const raw = { assignment: /** @type {string[]} */ ([]), exam: /** @type {string[]} */ ([]) };
  const t = normalizeText(text);

  for (const m of t.matchAll(re)) {
    const denominator = m[2].replace('S', '5');
    const field = denominator === '25' ? 'assignment' : 'exam';
    const value = parseMarkToken(m[1], tolerant);
    if (value === null) continue;
    raw[field].push(m[0]);
    found[field].add(value);
  }

  const max = { assignment: MAX_ASSIGNMENT, exam: MAX_EXAM };
  /** @type {{ assignment: number | null, exam: number | null }} */
  const out = { assignment: null, exam: null };
  for (const field of /** @type {const} */ (['assignment', 'exam'])) {
    const values = [...found[field]];
    if (values.length === 0) {
      errors.push({
        code: 'marks_not_found',
        field,
        message: `No "n/${max[field]}" value found for ${field}`,
      });
    } else if (values.length > 1) {
      errors.push({
        code: 'ambiguous_marks',
        field,
        message: `Several different values for ${field}: ${raw[field].join(', ')}`,
      });
    } else if (values[0] > max[field]) {
      errors.push({
        code: 'marks_out_of_range',
        field,
        message: `${field} ${values[0]} is above the maximum of ${max[field]}`,
      });
    } else {
      out[field] = values[0];
    }
  }
  return { ...out, errors };
}

// ---------------------------------------------------------------- names

/**
 * Is this string a believable person name? Letters and combining marks only (plus space,
 * full stop, apostrophe, hyphen). `\p{M}` is essential: Devanagari vowel signs and the virama
 * are combining marks, so a letters-only check rejects real Devanagari names (NOTES.md §3).
 * OCR junk such as "7" or "|||" fails, and callers must treat that as "not confirmed".
 * @param {string} s
 */
export function isPlausibleName(s) {
  const t = normalizeText(s);
  if (t.length < 2 || t.length > 100) return false;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(t)) return false;
  const letters = t.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && new Set(letters).size >= 2;
}

/**
 * Is this string a believable course title? Digits and common punctuation are allowed
 * ("Programming in Java", "Data Structures & Algorithms - Part 2"); mostly-symbol junk is not.
 * @param {string} s
 */
export function isPlausibleCourse(s) {
  const t = normalizeText(s);
  if (t.length < 3 || t.length > 200) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const visible = t.replace(/\s/g, '').length;
  return letters >= 3 && letters / visible >= 0.6;
}

// ---------------------------------------------------------------- roll number

// Observed: NPTEL25MG18S<9 digits>, NPTEL26HS164S<9 digits> (NOTES.md §1).
const ROLL_RE = /\bNPTEL\d{2}[A-Z]{2}\d{2,3}[A-Z]\d{6,12}\b/;

/**
 * @param {string} text
 * @returns {string | undefined}
 */
export function findRollNo(text) {
  return ROLL_RE.exec(normalizeText(text))?.[0];
}

// ---------------------------------------------------------------- NPTEL host allowlist

/**
 * Is this hostname `nptel.ac.in` or a subdomain of it? Used for the QR payload here and, via
 * `isAllowedNptelUrl`, for every server-side fetch and redirect hop (CLAUDE.md rule 3), so there is
 * one definition. Takes `URL.hostname`, never `URL.host`: look-alikes such as
 * `nptel.ac.in.evil.com` and `evilnptel.ac.in` fail.
 * @param {string} hostname
 */
export function isNptelHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === 'nptel.ac.in' || h.endsWith('.nptel.ac.in');
}

/**
 * May the server fetch this URL? https only, no credentials, port 443 only (NPTEL's own 302s carry
 * an explicit `:443`), and an NPTEL hostname.
 * @param {URL} u
 */
export function isAllowedNptelUrl(u) {
  return (
    u.protocol === 'https:' &&
    !u.username &&
    !u.password &&
    (u.port === '' || u.port === '443') &&
    isNptelHostname(u.hostname)
  );
}

// ---------------------------------------------------------------- verification URL

/**
 * Validate and classify a QR payload. Only https URLs on `nptel.ac.in` or `*.nptel.ac.in` are
 * accepted (rule 3); the host is checked with `URL.hostname`, so look-alikes such as
 * `nptel.ac.in.evil.com` and `evilnptel.ac.in` are rejected. Query and fragment are dropped.
 *
 * Shapes (NOTES.md §2): `/verify/<ID>` (ID like NOC-xxxx-xxxx-xxxxx) and
 * `/noc/E_Certificate/<ID>` (ID = roll number + 8 digits).
 *
 * @param {string} raw
 * @returns {{ url: string, shape: 'verify' | 'e_certificate', certificateId: string, error?: undefined }
 *   | { error: ParseError }}
 */
export function parseVerifyUrl(raw) {
  /** @param {string} code @param {string} message */
  const fail = (code, message) => ({ error: { code, message } });
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return fail('qr_not_url', 'The QR code does not contain a URL');
  }
  if (u.protocol !== 'https:')
    return fail('qr_unsupported_scheme', `The QR URL uses ${u.protocol}, only https is accepted`);
  const host = u.hostname.toLowerCase();
  if (!isAllowedNptelUrl(u)) {
    return fail('qr_not_nptel', 'The QR code points outside nptel.ac.in');
  }
  const verify = /^\/verify\/([A-Za-z0-9-]{6,64})\/?$/.exec(u.pathname);
  if (verify)
    return { url: `https://${host}/verify/${verify[1]}`, shape: 'verify', certificateId: verify[1] };
  const ecert = /^\/noc\/E_Certificate\/([A-Za-z0-9_-]{6,64})\/?$/i.exec(u.pathname);
  if (ecert) {
    return {
      url: `https://${host}/noc/E_Certificate/${ecert[1]}`,
      shape: 'e_certificate',
      certificateId: ecert[1],
    };
  }
  return fail('qr_unknown_shape', 'The QR URL is on nptel.ac.in but is not a known certificate URL shape');
}

// ---------------------------------------------------------------- full text layer

// Items that are never the name or the course. Anchored so a course called "...credits..." is not hit.
const NOISE_RE =
  /roll\s*no|credits? recommended|week course|to verify|candidates certified|^\d+(?:\.\d+)?\s*%?$|^NPTEL\d{2}/i;

/**
 * Group text items into lines (items whose y differ by less than `tolerance`), top line first,
 * each line's items left to right.
 * @param {TextItem[]} items
 * @param {number} tolerance
 */
function toLines(items, tolerance) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  /** @type {{ y: number, items: TextItem[] }[]} */
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => ({
    y: l.y,
    text: normalizeText(
      l.items
        .sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
        .map((i) => i.str)
        .join(' '),
    ),
  }));
}

/**
 * Parse a certificate from its text layer: marks by pattern, name and course by position
 * (name = the top line above the marks row, course = the lines between it and the marks, with
 * the bare total such as `91%` or `84` ignored).
 *
 * Verified layouts: Jul–Sep 2026 and Jan–Feb 2025 NPTEL PDFs (the item order differs between
 * them, so position, not order, is used). Other layouts yield errors, not guesses.
 *
 * @param {TextItem[]} rawItems
 * @param {{ page?: { height: number } }} [opts]
 * `total` is the bare overall score between the course and the marks row (`91%` in the 2026
 * layout, `84` in the 2025 one); it is informational and its absence is not an error.
 *
 * @returns {{ name: string | null, course: string | null, assignment: number | null,
 *   exam: number | null, total: number | null, rollNo?: string, errors: ParseError[] }}
 */
export function parseCertificateText(rawItems, { page } = {}) {
  const items = rawItems
    .map((i) => ({ ...i, str: normalizeText(i.str) }))
    .filter((i) => i.str !== '' && Number.isFinite(i.y));
  const allText = items.map((i) => i.str).join(' ');
  const marks = parseMarks(allText);
  /** @type {ParseError[]} */
  const errors = [...marks.errors];
  const rollNo = findRollNo(allText);

  /** @type {string | null} */
  let name = null;
  /** @type {string | null} */
  let course = null;
  /** @type {number | null} */
  let total = null;

  // The marks row: any item whose own text carries an n/25 or n/75.
  const markItems = items.filter((i) => /\d\s*\/\s*(25|75)(?!\d)/.test(i.str));
  if (markItems.length === 0) {
    errors.push({
      code: 'layout_not_recognised',
      field: 'name',
      message: 'No marks row found, so the name and course cannot be located',
    });
  } else {
    const marksY = Math.max(...markItems.map((i) => i.y));
    const tolerance = Math.max(3, (page?.height ?? 600) * 0.005);
    const above = items.filter((i) => i.y > marksY + tolerance && !NOISE_RE.test(i.str));
    const lines = toLines(above, tolerance);
    // The total: the bare number nearest above the marks row.
    const totalItem = items
      .filter((i) => i.y > marksY + tolerance && /^\d+(?:\.\d+)?\s*%?$/.test(i.str))
      .sort((a, b) => a.y - b.y)[0];
    if (totalItem) {
      const value = Number.parseFloat(totalItem.str);
      if (value >= 0 && value <= 100) total = value;
    }
    if (lines.length < 2) {
      errors.push({
        code: 'layout_not_recognised',
        field: lines.length === 0 ? 'name' : 'course',
        message: `Expected a name line and a course line above the marks row, found ${lines.length}`,
      });
    } else {
      const candidateName = lines[0].text;
      const candidateCourse = normalizeText(
        lines
          .slice(1)
          .map((l) => l.text)
          .join(' '),
      );
      if (isPlausibleName(candidateName)) name = candidateName;
      else
        errors.push({
          code: 'name_malformed',
          field: 'name',
          message: 'The text above the course does not look like a name',
        });
      if (isPlausibleCourse(candidateCourse)) course = candidateCourse;
      else
        errors.push({
          code: 'course_malformed',
          field: 'course',
          message: 'The course text does not look like a course title',
        });
    }
  }

  return {
    name,
    course,
    assignment: marks.assignment,
    exam: marks.exam,
    total,
    ...(rollNo ? { rollNo } : {}),
    errors,
  };
}
