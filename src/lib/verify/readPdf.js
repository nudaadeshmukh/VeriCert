// Text layer of NPTEL's own certificate PDF, read ON THE SERVER with unpdf (CLAUDE.md stack).
// Returns positioned items in the shape `parseCertificateText` (src/lib/extract/parse.js) takes,
// so the source PDF and the uploaded certificate are parsed by the same code.
//
// No OCR on the server in v1: a PDF without a text layer is `source_unreadable`.

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{ items: { str: string, x: number, y: number, h: number }[],
 *   page: { width: number, height: number }, pageCount: number }>}
 * @throws if the bytes are not a readable PDF
 */
export async function readSourcePdf(bytes) {
  // Dynamic: keeps unpdf (and its bundled pdf.js) out of cold starts that never verify anything.
  const { getDocumentProxy, extractTextItems } = await import('unpdf');
  const doc = await getDocumentProxy(bytes.slice());
  try {
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    const { items } = await extractTextItems(doc);
    return {
      items: (items[0] ?? [])
        .filter((i) => i.str.trim() !== '')
        .map((i) => ({ str: i.str, x: i.x, y: i.y, h: i.height })),
      page: { width: view.width, height: view.height },
      pageCount: doc.numPages,
    };
  } finally {
    await doc.loadingTask?.destroy?.();
  }
}
