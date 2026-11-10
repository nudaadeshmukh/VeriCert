// extractCertificate(file): the single entry point of the browser extraction engine.
//
// The file never leaves the browser (CLAUDE.md rule 1): this module reads it locally and
// returns only the extracted fields. It never throws; every failure is an entry in `errors`
// with a specific code, and the affected field is `null` (rule 6: nothing is guessed).
import { readPdf } from './pdf.js';
import { decodeQr } from './qr.js';
import { ocrCertificate } from './ocr.js';
import { createCanvas } from './image.js';
import { parseCertificateText } from './parse.js';

/**
 * @typedef {{ code: string, field?: string, message: string }} ExtractError
 * @typedef {{
 *   name: string | null, course: string | null, assignment: number | null, exam: number | null,
 *   verifyUrl: string | null, certificateId: string | null, rollNo?: string,
 *   source: 'text_layer' | 'ocr',
 *   fileKind: 'pdf' | 'png' | 'jpeg' | null,
 *   qr?: { method: string, shape: string, attempts: number },
 *   ocrConfidence?: { name?: number, course?: number, marks?: number },
 *   timings: Record<string, number>,
 *   errors: ExtractError[],
 * }} ExtractResult
 */

/**
 * Identify the file by its first bytes, not its name or MIME type (both can lie).
 * @param {Blob} file
 * @returns {Promise<'pdf' | 'png' | 'jpeg' | null>}
 */
export async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf'; // %PDF-
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}

/** Errors that mean "the text layer had no usable value", so OCR is worth trying. Out-of-range
 * and ambiguous values are real readings of a bad value, and OCR must not override them. */
const OCR_WORTHY = new Set([
  'marks_not_found',
  'layout_not_recognised',
  'name_malformed',
  'course_malformed',
]);

const round = (n) => Math.round(n);

/**
 * @param {File | Blob} file a PDF, JPG or PNG
 * @param {{ ocrBudgetMs?: number, debug?: boolean, evidence?: boolean }} [opts] `debug` adds the raw OCR text (dev only: it may contain personal data).
 *   `evidence` (PDFs only) adds `out.evidence` for the Phase 4 tampering checks: the retained PDF bytes, pdf.js' metadata,
 *   the text-layer values, and an OCR of the rendered page's name, course and marks crops
 * @returns {Promise<ExtractResult>}
 */
export async function extractCertificate(file, { ocrBudgetMs, debug = false, evidence = false } = {}) {
  const start = performance.now();
  /** @type {ExtractResult} */
  const out = {
    name: null,
    course: null,
    assignment: null,
    exam: null,
    verifyUrl: null,
    certificateId: null,
    source: 'text_layer',
    fileKind: null,
    timings: {},
    errors: [],
  };
  /** @type {HTMLCanvasElement | undefined} */
  let canvas;

  try {
    const kind = await sniffType(file);
    out.fileKind = kind;
    if (!kind) {
      out.errors.push({ code: 'unsupported_type', message: 'Not a PDF, JPG or PNG file' });
      return finish(out, start);
    }

    /** Errors from the text layer, by field, so OCR can replace them. */
    let textErrors = [];
    let needOcr = { identity: false, marks: false, roll: false };

    if (kind === 'pdf') {
      let pdf;
      try {
        pdf = await readPdf(file);
      } catch (err) {
        const code = err?.name === 'PasswordException' ? 'pdf_password' : 'pdf_unreadable';
        out.errors.push({
          code,
          message:
            code === 'pdf_password'
              ? 'The PDF is password protected'
              : `The PDF could not be opened (${err?.name}: ${String(err?.message).slice(0, 200)})`,
        });
        return finish(out, start);
      }
      canvas = pdf.canvas;
      out.timings.loadMs = round(pdf.timings.loadMs);
      out.timings.renderMs = round(pdf.timings.renderMs);

      const t = performance.now();
      const parsed = parseCertificateText(pdf.items, { page: pdf.page });
      out.timings.textParseMs = round(performance.now() - t);
      Object.assign(out, {
        name: parsed.name,
        course: parsed.course,
        assignment: parsed.assignment,
        exam: parsed.exam,
      });
      if (parsed.rollNo) out.rollNo = parsed.rollNo;
      textErrors = parsed.errors;
      if (evidence) {
        out.evidence = {
          pdfBytes: pdf.bytes,
          pdfInfo: pdf.info,
          // what the TEXT LAYER said, before any OCR fallback fills gaps
          textLayer: {
            name: parsed.name,
            course: parsed.course,
            assignment: parsed.assignment,
            exam: parsed.exam,
          },
          renderOcr: null,
        };
      }

      const worthy = (field) => textErrors.some((e) => e.field === field && OCR_WORTHY.has(e.code));
      needOcr = {
        identity: (out.name === null && worthy('name')) || (out.course === null && worthy('course')),
        marks: (out.assignment === null && worthy('assignment')) || (out.exam === null && worthy('exam')),
        roll: false,
      };
    } else {
      const t = performance.now();
      try {
        const bitmap = await createImageBitmap(file);
        canvas = createCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch {
        out.errors.push({ code: 'image_unreadable', message: 'The image could not be decoded' });
        return finish(out, start);
      }
      out.timings.loadMs = round(performance.now() - t);
      out.source = 'ocr'; // an image has no text layer, whatever OCR manages to read
      // No text layer: everything but the QR comes from OCR of crops.
      needOcr = { identity: true, marks: true, roll: true };
    }

    // QR code (both URL shapes).
    const q = performance.now();
    const qr = await decodeQr(canvas, { trace: debug ? (out.qrTrace = []) : undefined });
    out.timings.qrMs = round(performance.now() - q);
    if (qr.error) {
      out.errors.push({
        ...qr.error,
        message: `${qr.error.message} (${qr.attempts} decode attempts)`,
        field: 'verifyUrl',
      });
    } else {
      out.verifyUrl = qr.url;
      out.certificateId = qr.certificateId;
      out.qr = { method: qr.method, shape: qr.shape, attempts: qr.attempts };
    }

    // OCR fallback for whatever the text layer could not give (crops only, 8 s budget).
    /** @type {ExtractError[]} */
    let ocrErrors = [];
    if (needOcr.identity || needOcr.marks || needOcr.roll) {
      const o = performance.now();
      const ocr = await ocrCertificate(canvas, { budgetMs: ocrBudgetMs, need: needOcr, debug });
      out.timings.ocrMs = round(performance.now() - o);
      for (const [k, v] of Object.entries(ocr.timings)) out.timings[`ocr_${k}`] = round(v);
      let used = false;
      if (needOcr.identity) {
        if (out.name === null && ocr.name !== null) ((out.name = ocr.name), (used = true));
        if (out.course === null && ocr.course !== null) ((out.course = ocr.course), (used = true));
      }
      if (needOcr.marks) {
        if (out.assignment === null && ocr.assignment !== null)
          ((out.assignment = ocr.assignment), (used = true));
        if (out.exam === null && ocr.exam !== null) ((out.exam = ocr.exam), (used = true));
      }
      if (!out.rollNo && ocr.rollNo) ((out.rollNo = ocr.rollNo), (used = true));
      if (used) {
        out.source = 'ocr';
        out.ocrConfidence = ocr.confidence;
      }
      ocrErrors = ocr.errors;
      if (debug) out.debug = ocr.debug;
    }

    // Tampering evidence (opt-in, PDFs only): read the RENDERED page's name, course and marks with the same
    // OCR (crops only, agreement rule, 8 s budget) so layer_vs_render can compare it with the text layer.
    if (evidence && kind === 'pdf' && out.evidence) {
      const tl = out.evidence.textLayer;
      const hasIdentity = tl.name !== null || tl.course !== null;
      const hasMarks = tl.assignment !== null || tl.exam !== null;
      if (!hasIdentity && !hasMarks) {
        out.evidence.renderOcrSkipped = 'no_text_layer';
      } else {
        const e = performance.now();
        const r = await ocrCertificate(canvas, {
          budgetMs: ocrBudgetMs,
          need: { identity: hasIdentity, marks: hasMarks, roll: false },
          debug,
        });
        out.timings.evidenceOcrMs = round(performance.now() - e);
        out.evidence.renderOcr = {
          name: r.name,
          course: r.course,
          assignment: r.assignment,
          exam: r.exam,
          confidence: r.confidence,
          errors: r.errors,
          timings: r.timings,
        };
      }
    }

    // Final error list: only problems that remain. A text-layer error for a field that OCR
    // then filled is dropped; OCR errors for fields still empty are kept (they say why).
    const stillNull = (field) => out[field] === null;
    for (const e of textErrors) {
      if (e.field && !stillNull(e.field)) continue;
      // layout_not_recognised is reported against name/course; skip if OCR replaced both.
      out.errors.push(e);
    }
    for (const e of ocrErrors) {
      if (e.field && !stillNull(e.field)) continue;
      if (e.field === undefined || !out.errors.some((x) => x.field === e.field && x.code === e.code))
        out.errors.push(e);
    }
  } catch (err) {
    out.errors.push({ code: 'extract_failed', message: `Extraction failed: ${err?.message ?? err}` });
  } finally {
    if (canvas) canvas.width = canvas.height = 0; // release the page bitmap
  }
  return finish(out, start);
}

/**
 * @param {ExtractResult} out
 * @param {number} start
 */
function finish(out, start) {
  out.timings.totalMs = round(performance.now() - start);
  return out;
}
