'use client';

import { useState } from 'react';
import { vendorUrl } from '../../../src/lib/extract/vendor.js';

/**
 * Dev scratch UI: runs extractCertificate on the chosen files in THIS browser and prints the JSON.
 * `?budget=<ms>` overrides the OCR budget (to test the timeout path).
 * For PDFs it also reports two checks on the ArrayBuffer-detachment known fact:
 *   - `pdfBytes`: readPdf() keeps its own bytes intact after pdf.js has run;
 *   - `detachControl`: handing pdf.js the ORIGINAL buffer does detach it (the bug we guard against).
 */
export default function ExtractScratch() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  async function onChange(event) {
    const files = [...event.target.files];
    const params = new URLSearchParams(window.location.search);
    const budget = params.get('budget');
    const evidence = params.get('evidence') === '1';
    setBusy(true);
    setRows([]);
    // Loaded here (not at import time) so pdf.js, zxing and tesseract stay lazy.
    const { extractCertificate, sniffType } = await import('../../../src/lib/extract/index.js');
    const next = [];
    for (const file of files) {
      const result = await extractCertificate(file, {
        debug: true,
        evidence,
        ...(budget ? { ocrBudgetMs: Number(budget) } : {}),
      });
      // Never put the PDF bytes into the page: show their length only.
      if (result.evidence?.pdfBytes) {
        result.evidence = { ...result.evidence, pdfBytes: `[${result.evidence.pdfBytes.length} bytes]` };
      }
      const row = { fileName: file.name, result };
      if ((await sniffType(file)) === 'pdf') {
        row.pdfChecks = await pdfChecks(file).catch((err) => ({ error: String(err?.name) }));
      }
      next.push(row);
      setRows([...next]);
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-[1640px] px-6 py-16">
      <h1 className="text-heading-md text-on-primary">extractCertificate (dev scratch)</h1>
      <input
        data-testid="file-input"
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        onChange={onChange}
        className="mt-6 block"
        aria-label="Certificate files"
      />
      <p data-testid="status" className="mt-4 font-mono text-mono-eyebrow">
        {busy ? 'running' : rows.length ? 'done' : 'idle'}
      </p>
      {rows.map((row) => (
        <section key={row.fileName} className="mt-6">
          <h2 className="text-body-sm text-on-primary">{row.fileName}</h2>
          <pre data-testid={`result-${row.fileName}`} className="overflow-x-auto text-caption">
            {JSON.stringify(row.result, null, 2)}
          </pre>
          {row.pdfChecks && (
            <pre data-testid={`pdfchecks-${row.fileName}`} className="overflow-x-auto text-caption">
              {JSON.stringify(row.pdfChecks)}
            </pre>
          )}
        </section>
      ))}
    </main>
  );
}

async function pdfChecks(file) {
  const { readPdf } = await import('../../../src/lib/extract/pdf.js');
  const pdf = await readPdf(file);
  const magic = String.fromCharCode(...pdf.bytes.slice(0, 5));
  // Control: pass the original ArrayBuffer to pdf.js and see whether it is detached afterwards.
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
  const original = await file.arrayBuffer();
  const before = original.byteLength;
  const task = pdfjs.getDocument({ data: new Uint8Array(original), wasmUrl: vendorUrl('pdfjs/wasm/') });
  await task.promise;
  const after = original.byteLength;
  await task.destroy();
  return {
    fileSize: file.size,
    keptBytesLength: pdf.bytes.byteLength,
    keptBytesMagic: magic,
    controlBefore: before,
    controlAfter: after,
  };
}
