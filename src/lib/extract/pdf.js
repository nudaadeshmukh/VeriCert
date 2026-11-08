// PDF loading, page-1 rendering and text-layer reading (browser only).
import { createCanvas } from './image.js';
import { vendorUrl } from './vendor.js';

/** Render scale target (plan: "about 3x"). */
export const TARGET_SCALE = 3;
/**
 * Never render a page larger than this on its longest side. The 2025 NPTEL PDFs are already
 * 2552 pt wide: 3x would be a 7657 x 5486 canvas (about 168 MB of pixels), and the QR code
 * decoded fine at 1x there (NOTES.md §2.2). A normal A4-landscape page (842 pt) gets the full 3x.
 */
export const MAX_RENDER_SIDE = 3200;

/** pdf.js can sit forever on a corrupt file; a normal load takes ~0.3 s and a render ~0.13 s. */
export const PDF_LOAD_TIMEOUT_MS = 10_000;
export const PDF_RENDER_TIMEOUT_MS = 15_000;

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${what} took longer than ${ms} ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let pdfjsPromise;
/** pdf.js is loaded on first use, never at page load. */
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * Open a PDF, render page 1 and read its text layer.
 *
 * IMPORTANT (CLAUDE.md known fact, challenges-log "detached ArrayBuffer"): pdf.js transfers the
 * buffer it is given to its worker, which detaches it. We hand pdf.js a COPY (`bytes.slice()`)
 * and keep the original `bytes` intact for any later use (Phase 4's raw-metadata scan).
 *
 * @param {File | Blob} file
 * @returns {Promise<{
 *   bytes: Uint8Array,
 *   pageCount: number,
 *   page: { width: number, height: number },
 *   items: { str: string, x: number, y: number, h: number }[],
 *   canvas: HTMLCanvasElement,
 *   renderScale: number,
 *   timings: { loadMs: number, renderMs: number }
 * }>}
 */
export async function readPdf(file) {
  const t0 = performance.now();
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data: bytes.slice(), // copy: pdf.js detaches whatever it is given
    wasmUrl: vendorUrl('pdfjs/wasm/'),
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    isEvalSupported: false,
  });
  /** @type {import('pdfjs-dist').PDFDocumentProxy} */
  let doc;
  try {
    doc = await withTimeout(task.promise, PDF_LOAD_TIMEOUT_MS, 'Opening the PDF');
  } catch (err) {
    await task.destroy().catch(() => {}); // stop the worker working on a file that will not open
    throw err;
  }
  try {
    const pdfPage = await withTimeout(doc.getPage(1), PDF_LOAD_TIMEOUT_MS, 'Reading page 1');
    const base = pdfPage.getViewport({ scale: 1 });
    const content = await withTimeout(
      pdfPage.getTextContent(),
      PDF_LOAD_TIMEOUT_MS,
      'Reading the text layer',
    );
    const items = content.items
      .filter((i) => 'str' in i && i.str.trim() !== '')
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], h: i.height }));
    const loadMs = performance.now() - t0;

    const t1 = performance.now();
    const renderScale = Math.min(TARGET_SCALE, MAX_RENDER_SIDE / Math.max(base.width, base.height));
    const viewport = pdfPage.getViewport({ scale: renderScale });
    const canvas = createCanvas(viewport.width, viewport.height);
    await withTimeout(
      pdfPage.render({ canvas, viewport, background: '#ffffff' }).promise,
      PDF_RENDER_TIMEOUT_MS,
      'Rendering the page',
    );
    const renderMs = performance.now() - t1;

    return {
      bytes,
      pageCount: doc.numPages,
      page: { width: base.width, height: base.height },
      items,
      canvas,
      renderScale,
      timings: { loadMs, renderMs },
    };
  } finally {
    await task.destroy();
  }
}
