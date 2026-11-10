// Tampering checks and the tampering verdict (docs/implementation_plan.md, Phase 4).
//
// Independent of Verification (CLAUDE.md "Result semantics"). Each check returns
//   { id, outcome: 'pass' | 'fail' | 'not_confirmed' | 'not_applicable', detail }
// and the verdict is exactly one of `Tampering detected`, `No tampering detected`, `Not checked` (rule 6: no
// third state). An unreadable or malformed value is `not_confirmed`, never `fail` (rule 6); a `fail` needs a
// signal that was confirmed against genuine samples (rule 7), with every bound in config.js.
//
// PURE: no browser APIs and no I/O. The browser gathers the evidence (src/lib/extract: the PDF bytes, the text layer
// and an OCR of the render), the server supplies NPTEL's values; this module only judges them.
import { normalizeForCompare } from '../compare.js';
import { readPdfMetadata } from './metadata.js';
import {
  BASELINE_STRUCTURE,
  CORE_CHECKS,
  EDITOR_DENYLIST,
  LAYER_MARK_TOLERANCE,
  LAYER_TEXT_MIN_DIFFERENCE_RATIO,
  LAYER_TEXT_MIN_OCR_CONFIDENCE,
  MODDATE_MIN_GAP_SECONDS,
  NOT_CONFIRMED_LIMIT,
} from './config.js';

/**
 * @typedef {{ id: string, outcome: 'pass' | 'fail' | 'not_confirmed' | 'not_applicable', detail: string }} Check
 * @typedef {'Tampering detected' | 'No tampering detected' | 'Not checked'} TamperVerdict
 */

/** Unit conversion for messages only; every threshold lives in config.js. */
const SECONDS_PER_DAY = 24 * 60 * 60;

/** @type {(id: string, detail: string) => Check} */
const pass = (id, detail) => ({ id, outcome: 'pass', detail });
/** @type {(id: string, detail: string) => Check} */
const fail = (id, detail) => ({ id, outcome: 'fail', detail });
/** @type {(id: string, detail: string) => Check} */
const unconfirmed = (id, detail) => ({ id, outcome: 'not_confirmed', detail });
/** @type {(id: string, detail: string) => Check} */
const notApplicable = (id, detail) => ({ id, outcome: 'not_applicable', detail });

// ------------------------------------------------------------------------------------------- id_match

/**
 * The certificate ID in the QR URL against the roll number printed on the certificate, where the format makes that
 * comparable.
 *
 * - `/noc/E_Certificate/<ID>`: the ID is the roll number followed by 8 digits (G2/G3: `<roll>` followed by 8 digits), so the
 *   ID must START WITH the printed roll number.
 * - `/verify/<ID>`: the ID looks like `NOC-xxxx-xxxx-xxxxx`, with no relationship to the roll number
 *   (`NPTEL26HS164S…`) in the one genuine sample (G1), so the two are NOT compared (`not_applicable`).
 *
 * A roll number read by OCR that does not match is `not_confirmed`, not a fail: OCR is known to confuse S and 5
 * in it (C-011). Only a roll from the text layer can fail.
 *
 * @param {{ qr?: { shape: string }, certificateId: string | null, rollNo?: string, source?: string }} x
 * @returns {Check}
 */
export function idMatchCheck(x) {
  const id = 'id_match';
  if (!x.certificateId || !x.qr) return unconfirmed(id, 'No certificate ID could be read from the QR code');
  if (x.qr.shape === 'verify') {
    return notApplicable(
      id,
      'A /verify/<ID> URL carries an NOC-xxxx-xxxx-xxxxx ID with no observed relationship to the printed roll number, so they are not compared',
    );
  }
  if (!x.rollNo) return unconfirmed(id, 'The roll number printed on the certificate was not read');
  if (x.certificateId.toUpperCase().startsWith(x.rollNo.toUpperCase())) {
    return pass(id, 'The QR certificate ID starts with the printed roll number');
  }
  if (x.source === 'ocr') {
    return unconfirmed(
      id,
      `The roll number read by OCR (${x.rollNo}) is not a prefix of the QR ID; OCR text is not treated as a mismatch`,
    );
  }
  return fail(
    id,
    `The QR certificate ID does not start with the roll number printed on the certificate (${x.rollNo})`,
  );
}

// ------------------------------------------------------------------- name_match, course_match, marks_match

/**
 * The name and course checks come from `compareCertificate` (src/lib/compare.js), which already applies the
 * normalisation and the "OCR text is never a mismatch" rule.
 * @param {{ checks: Check[] }} comparison
 * @param {'name_match' | 'course_match'} id
 * @returns {Check}
 */
export function textMatchCheck(comparison, id) {
  const c = comparison.checks.find((k) => k.id === id);
  return c ?? unconfirmed(id, 'Not compared');
}

/**
 * The marks on the certificate against NPTEL's. A mark present on both sides that differs fails (as for the
 * Verification verdict, a differing mark is proof of a mismatch); a missing value alone is `not_confirmed`.
 * @param {{ marks: Record<'assignment' | 'exam', { certificate: number | null, source: number | null,
 *   outcome: 'match' | 'differ' | 'missing' }>, reason: string | null }} comparison
 * @returns {Check}
 */
export function marksMatchCheck(comparison) {
  const id = 'marks_match';
  const rows = /** @type {const} */ (['assignment', 'exam']).map((f) => ({ f, ...comparison.marks[f] }));
  const differ = rows.filter((r) => r.outcome === 'differ');
  if (differ.length > 0) {
    return fail(
      id,
      differ
        .map(
          (r) =>
            `${r.f === 'assignment' ? 'Assignment' : 'Exam'} marks on the certificate are ${r.certificate}, NPTEL has ${r.source}`,
        )
        .join('; '),
    );
  }
  if (rows.some((r) => r.outcome === 'missing')) {
    return unconfirmed(id, comparison.reason ?? 'A mark could not be compared');
  }
  return pass(id, "Both marks equal NPTEL's");
}

// -------------------------------------------------------------------------------------- layer_vs_render

/**
 * Edit distance / length of the longer string, by code points (Unicode-safe).
 * @param {string} a
 * @param {string} b
 */
export function differenceRatio(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0 && y.length === 0) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length] / Math.max(x.length, y.length);
}

/**
 * PDF only: the values in the text layer against an OCR of the SAME fields on the rendered page. A mismatch counts
 * only if the OCR output is well-formed and clearly different; anything unreadable is `not_confirmed`.
 *
 * - marks: the OCR value already passed Phase 2's agreement rule; any difference above the tolerance fails.
 * - name, course: fails only if the OCR line's confidence and the fraction of differing characters both clear the
 *   bounds in config.js; otherwise a difference is `not_confirmed`.
 *
 * @param {{ textLayer: Record<string, any>, renderOcr: Record<string, any> | null,
 *   renderOcrSkipped?: string } | null | undefined} evidence
 * @param {string} [fileKind]
 * @returns {Check}
 */
export function layerVsRenderCheck(evidence, fileKind) {
  const id = 'layer_vs_render';
  if (fileKind && fileKind !== 'pdf')
    return notApplicable(id, 'Only PDFs have a text layer to compare with the render');
  if (!evidence) return unconfirmed(id, 'No render evidence was collected');
  if (evidence.renderOcrSkipped === 'no_text_layer') {
    return notApplicable(id, 'The PDF has no text layer, so there is nothing to compare with the render');
  }
  const ocr = evidence.renderOcr;
  if (!ocr) return unconfirmed(id, 'The rendered page could not be read');
  const tl = evidence.textLayer;

  /** @type {string[]} */ const different = [];
  /** @type {string[]} */ const same = [];
  /** @type {string[]} */ const unclear = [];

  for (const f of /** @type {const} */ (['assignment', 'exam'])) {
    if (tl[f] === null || tl[f] === undefined) continue;
    const label = f === 'assignment' ? 'assignment marks' : 'exam marks';
    if (ocr[f] === null || ocr[f] === undefined) unclear.push(`${label} (not readable on the render)`);
    else if (Math.abs(ocr[f] - tl[f]) <= LAYER_MARK_TOLERANCE + 1e-9) same.push(label);
    else different.push(`${label}: text layer ${tl[f]}, render ${ocr[f]}`);
  }
  for (const f of /** @type {const} */ (['name', 'course'])) {
    if (!tl[f]) continue;
    if (!ocr[f]) {
      unclear.push(`${f} (not readable on the render)`);
      continue;
    }
    if (normalizeForCompare(tl[f]) === normalizeForCompare(ocr[f])) {
      same.push(f);
      continue;
    }
    const confidence = ocr.confidence?.[f];
    const ratio = differenceRatio(normalizeForCompare(tl[f]), normalizeForCompare(ocr[f]));
    if (
      typeof confidence === 'number' &&
      confidence >= LAYER_TEXT_MIN_OCR_CONFIDENCE &&
      ratio >= LAYER_TEXT_MIN_DIFFERENCE_RATIO
    ) {
      different.push(`${f}: text layer "${tl[f]}", render "${ocr[f]}"`);
    } else {
      unclear.push(`${f} (render text differs slightly or with low confidence; not treated as a mismatch)`);
    }
  }

  if (different.length > 0)
    return fail(id, `The text layer differs from what is drawn on the page: ${different.join('; ')}`);
  if (same.length > 0) {
    return pass(
      id,
      `Render matches the text layer for ${same.join(', ')}` +
        (unclear.length ? `; not confirmed: ${unclear.join(', ')}` : ''),
    );
  }
  return unconfirmed(
    id,
    `Nothing on the render could be confirmed against the text layer${unclear.length ? `: ${unclear.join(', ')}` : ''}`,
  );
}

// ------------------------------------------------------------------------------------------- metadata

/**
 * PDF only: raw-byte metadata. Fails on any of
 *   - a Producer or Creator (current, or left behind by an earlier save) on the editor denylist;
 *   - a ModDate more than MODDATE_MIN_GAP_SECONDS after the CreationDate;
 *   - more than one `%%EOF` / xref section, or a `/Prev` (an incremental update).
 * An unknown Producer is noted in the detail and never flags.
 *
 * @param {{ pdfBytes?: Uint8Array, pdfInfo?: Record<string, string> | null } | null | undefined} evidence
 * @param {string} [fileKind]
 * @returns {Check}
 */
export function metadataCheck(evidence, fileKind) {
  const id = 'metadata';
  if (fileKind && fileKind !== 'pdf') return notApplicable(id, 'Only PDFs carry this metadata');
  if (!evidence?.pdfBytes) return unconfirmed(id, 'The PDF bytes were not available');
  const m = readPdfMetadata(evidence.pdfBytes, evidence.pdfInfo ?? null);
  if (!m.header.startsWith('%PDF-')) return unconfirmed(id, 'The file does not start with a PDF header');
  if (m.eofCount === 0) return unconfirmed(id, 'No %%EOF marker found: the file may be truncated or damaged');
  if (m.encrypted) return unconfirmed(id, 'The PDF is encrypted; its structure cannot be assessed');

  /** @type {string[]} */ const problems = [];

  const tools = [
    m.producer,
    m.creator,
    ...m.allProducers,
    ...m.allCreators,
    m.xmpProducer,
    m.xmpCreatorTool,
  ].filter((t) => typeof t === 'string' && t.trim() !== '');
  for (const tool of new Set(tools)) {
    const hit = EDITOR_DENYLIST.find((e) => tool.toLowerCase().includes(e));
    if (hit) problems.push(`"${tool}" is a PDF editor (matches "${hit}")`);
  }

  if (m.creationDateParsed && m.modDateParsed) {
    const gap = (m.modDateParsed.getTime() - m.creationDateParsed.getTime()) / 1000;
    if (gap > MODDATE_MIN_GAP_SECONDS) {
      problems.push(`ModDate is ${(gap / SECONDS_PER_DAY).toFixed(1)} days after CreationDate`);
    }
  }

  const base = m.linearized ? BASELINE_STRUCTURE.linearized : BASELINE_STRUCTURE.plain;
  const xrefSections = m.xrefTableCount + m.xrefStreamCount;
  if (
    m.eofCount > base.eof ||
    m.startxrefCount > base.startxref ||
    xrefSections > base.xrefSections ||
    m.prevCount > base.prev
  ) {
    problems.push(
      `incremental update: ${m.eofCount} %%EOF, ${xrefSections} xref sections, ${m.prevCount} /Prev (an untouched NPTEL file has ${base.eof}, ${base.xrefSections}, ${base.prev})`,
    );
  }

  if (problems.length > 0) return fail(id, `PDF metadata shows signs of editing: ${problems.join('; ')}`);

  const notes = [];
  notes.push(
    m.producer ? `Producer "${m.producer}" is not on the editor list (noted, not flagged)` : 'no Producer',
  );
  if (!m.creationDate) notes.push('no CreationDate');
  if (!m.modDate) notes.push('no ModDate');
  return pass(id, `No sign of editing in the PDF structure or metadata (${notes.join('; ')})`);
}

// ------------------------------------------------------------------------------------------- verdict

/**
 * Judge a certificate. `extraction` is the result of `extractCertificate(file, { evidence: true })`; `comparison`
 * is `compareCertificate(extraction, verifyResult)`.
 *
 * Verdict (the plan):
 *   - any `fail`                                   → Tampering detected (the failing checks are named)
 *   - none of the core checks (name, course, marks) could run (no pass or fail among them) → Not checked
 *   - at least NOT_CONFIRMED_LIMIT of the applicable checks are not_confirmed → Not checked
 *   - otherwise (all pass / not_applicable / a minority not_confirmed)           → No tampering detected
 *
 * @param {{ extraction: any, comparison: any }} input
 * @returns {{ verdict: TamperVerdict, reason: string, failing: string[], checks: Check[] }}
 */
export function assessTampering({ extraction, comparison }) {
  const kind = extraction.fileKind;
  /** @type {Check[]} */
  const checks = [
    idMatchCheck(extraction),
    textMatchCheck(comparison, 'name_match'),
    textMatchCheck(comparison, 'course_match'),
    marksMatchCheck(comparison),
    layerVsRenderCheck(extraction.evidence, kind),
    metadataCheck(extraction.evidence, kind),
  ];

  const failing = checks.filter((c) => c.outcome === 'fail');
  if (failing.length > 0) {
    return {
      verdict: 'Tampering detected',
      reason: failing.map((c) => `${c.id}: ${c.detail}`).join(' | '),
      failing: failing.map((c) => c.id),
      checks,
    };
  }

  const coreRan = checks.some(
    (c) => CORE_CHECKS.includes(c.id) && (c.outcome === 'pass' || c.outcome === 'fail'),
  );
  if (!coreRan) {
    return {
      verdict: 'Not checked',
      reason: `The name, course and marks could not be compared with NPTEL's values${comparison.reason ? ` (${comparison.reason})` : ''}`,
      failing: [],
      checks,
    };
  }

  const applicable = checks.filter((c) => c.outcome !== 'not_applicable');
  const unknown = applicable.filter((c) => c.outcome === 'not_confirmed');
  if (unknown.length > 0 && unknown.length / applicable.length >= NOT_CONFIRMED_LIMIT) {
    return {
      verdict: 'Not checked',
      reason: `${unknown.length} of ${applicable.length} checks could not be confirmed: ${unknown.map((c) => c.id).join(', ')}`,
      failing: [],
      checks,
    };
  }

  return {
    verdict: 'No tampering detected',
    reason:
      unknown.length > 0
        ? `Not confirmed (a minority): ${unknown.map((c) => c.id).join(', ')}`
        : 'All applicable checks passed',
    failing: [],
    checks,
  };
}
