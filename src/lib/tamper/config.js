// EVERY threshold, list and tolerance used by the tampering checks (CLAUDE.md rule 7).
//
// Rule 7: never flag a signal that has not been confirmed against a known-genuine certificate. The
// evidence behind each value is cited by sample label; the samples themselves and the raw numbers are in
// NOTES.md §6. Samples:
//   G1  genuine Jul–Sep 2026 PDF, NPTEL-served (Producer MuPDF 1.28.2, no dates, 1 %%EOF)
//   G2  genuine Jan–Feb 2025 PDF, NPTEL-served (Producer FPDF 1.81, CreationDate only, 1 %%EOF)
//   G3  genuine 2025 screenshot (NPTEL.png): no PDF structure
// and the known-tampered NPTEL_tampered.png (marks edited), plus synthetic fixtures made by us.
//
// Where a value could not be calibrated on a genuine sample it says so and errs on the side of NOT flagging.
// Two genuine PDFs and one screenshot is a small basis: docs/progress.md lists what to revisit.

// ------------------------------------------------------------------------------------------ metadata

/**
 * Producer / Creator substrings (case-insensitive) of tools whose purpose is to EDIT a PDF or of online
 * editing services. A match in the current Producer/Creator, or in ANY earlier Producer left behind by an
 * incremental update, fails the `metadata` check.
 *
 * Evidence: G1 and G2 show only `MuPDF 1.28.2` and `FPDF 1.81`; none of these appears in a genuine file. That is
 * all the evidence there is (absence), so the list is short and limited to dedicated editors. Deliberately NOT
 * listed: generators that also make legitimate PDFs ("Adobe PDF Library", "Acrobat Distiller", Microsoft Word,
 * "Microsoft: Print To PDF", Chrome's "Skia/PDF", LibreOffice Writer), because NPTEL has changed generator
 * between sessions (G2 to G1) and a post-processing step in its pipeline is plausible (G1 is a MuPDF rewrite).
 * An unknown Producer is NOTED in the check's detail and never flags.
 */
export const EDITOR_DENYLIST = Object.freeze([
  'adobe acrobat', // the interactive editor ("Adobe Acrobat Pro DC ..."), not the PDF Library or Distiller
  'foxit phantom',
  'foxit pdf editor',
  'pdf-xchange editor',
  'nitro pro',
  'nitro pdf',
  'sejda',
  'ilovepdf',
  'smallpdf',
  'pdfescape',
  'pdffiller',
  'soda pdf',
  'pdfelement',
  'master pdf editor',
]);

/**
 * ModDate must be this many seconds after CreationDate to count as "meaningfully after".
 *
 * NOT calibrated on a genuine sample: neither G1 (no dates) nor G2 (CreationDate only) has a ModDate. One day is
 * chosen so that a generator stamping both dates within seconds, or across a timezone rounding, can never trip it.
 * Revisit when a genuine certificate that carries a ModDate is collected.
 */
export const MODDATE_MIN_GAP_SECONDS = 24 * 60 * 60;

/**
 * Structure of an untouched file. G1 and G2 both have exactly 1 `%%EOF`, 1 `startxref`, 1 xref section and no
 * `/Prev`. Anything above that is an incremental update (the way an editor appends changes), which fails.
 *
 * A LINEARIZED file legitimately has 2 of each and one `/Prev` by construction of the format; no genuine
 * linearized file has been seen (G1, G2: not linearized), so that allowance comes from the PDF specification and is
 * untested. It only ever loosens the check.
 */
export const BASELINE_STRUCTURE = Object.freeze({
  plain: Object.freeze({ eof: 1, startxref: 1, xrefSections: 1, prev: 0 }),
  linearized: Object.freeze({ eof: 2, startxref: 2, xrefSections: 2, prev: 1 }),
});

// -------------------------------------------------------------------------------------- layer_vs_render

/**
 * Marks read from the rendered page (OCR) must equal the text layer within this. Same tolerance as the
 * verification verdict (CLAUDE.md: 0.01). G1 and G2: render OCR equal to the text layer exactly on all four marks.
 * The OCR values only count when Phase 2's agreement rule accepted them (two passes agree, none disagree).
 */
export const LAYER_MARK_TOLERANCE = 0.01;

/**
 * A NAME or COURSE read from the render counts as "clearly different" from the text layer only if BOTH hold:
 *   - the OCR line's confidence is at least this: G1 and G2 read names at 92 to 93 and courses at 94 to 96, so 85 sits
 *     below every genuine reading and a low-confidence line is never trusted to contradict the text layer;
 *   - at least this fraction of the characters differ (edit distance / longer length). OCR slips seen so far are
 *     one character (C-010, C-011), about 0.05 for a 20-character name; 0.5 means half the text differs.
 * No genuine sample has ever shown ANY difference (distance 0 on all four of G1/G2's text fields), so neither bound
 * is measured against a genuine difference; both are set to refuse to flag rather than to catch every edit. Below
 * these bounds a difference is `not_confirmed`.
 */
export const LAYER_TEXT_MIN_OCR_CONFIDENCE = 85;
export const LAYER_TEXT_MIN_DIFFERENCE_RATIO = 0.5;

// ------------------------------------------------------------------------------------------- verdict

/**
 * If at least this fraction of the applicable checks are `not_confirmed`, the verdict is `Not checked` instead of
 * `No tampering detected` (the plan: a MINORITY of not_confirmed is tolerated). No genuine-sample basis: it is the
 * plan's word "minority" made concrete as "strictly less than half".
 */
export const NOT_CONFIRMED_LIMIT = 0.5;

/** The core checks (plan, Phase 4, items 2 and 3). If none of them could run the verdict is `Not checked`. */
export const CORE_CHECKS = Object.freeze(['name_match', 'course_match', 'marks_match']);
