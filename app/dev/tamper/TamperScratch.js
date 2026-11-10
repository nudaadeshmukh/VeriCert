'use client';

import { useState } from 'react';

/**
 * extractCertificate (with evidence) -> NPTEL source -> compareCertificate -> assessTampering, on the chosen files.
 *
 * NPTEL's source for a file comes from, in order:
 *   1. the "source map" box: JSON { "<file name>": <verifySource result> }, so tests need no network;
 *   2. with `?live=1`, the real POST /api/verify (enabled on the dev server) using the QR URL;
 *   3. otherwise "no source" (`source_unavailable`).
 * `?measure=1` also runs the extraction WITHOUT evidence first, to measure what the tampering checks add.
 */
export default function TamperScratch() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sourceMap, setSourceMap] = useState('{}');

  async function onChange(event) {
    const files = [...event.target.files];
    const params = new URLSearchParams(window.location.search);
    const live = params.get('live') === '1';
    const measure = params.get('measure') === '1';
    let map = {};
    try {
      map = JSON.parse(sourceMap || '{}');
    } catch {
      /* ignore: treated as an empty map */
    }
    setBusy(true);
    setRows([]);
    const { extractCertificate } = await import('../../../src/lib/extract/index.js');
    const { compareCertificate } = await import('../../../src/lib/compare.js');
    const { assessTampering } = await import('../../../src/lib/tamper/checks.js');
    const next = [];
    for (const file of files) {
      /** @type {Record<string, number>} */
      const timings = {};
      if (measure) {
        const t = performance.now();
        await extractCertificate(file);
        timings.baselineExtractMs = Math.round(performance.now() - t);
      }
      const t0 = performance.now();
      const extraction = await extractCertificate(file, { evidence: true });
      timings.evidenceExtractMs = Math.round(performance.now() - t0);

      let verification;
      if (map[file.name]) {
        verification = map[file.name];
      } else if (live && extraction.verifyUrl) {
        const t = performance.now();
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: extraction.verifyUrl }),
        });
        verification = await res.json();
        timings.verifyMs = Math.round(performance.now() - t);
      } else {
        verification = { source: null, error: 'source_unavailable', message: 'No NPTEL source was provided' };
      }

      const a0 = performance.now();
      const comparison = compareCertificate(extraction, verification);
      const tamper = assessTampering({ extraction, comparison });
      timings.assessMs = Math.round((performance.now() - a0) * 100) / 100;

      // Never put the PDF bytes into the page.
      const evidence = extraction.evidence
        ? { ...extraction.evidence, pdfBytes: `[${extraction.evidence.pdfBytes.length} bytes]` }
        : undefined;
      next.push({
        fileName: file.name,
        out: {
          fileKind: extraction.fileKind,
          source: extraction.source,
          verifyUrl: extraction.verifyUrl,
          rollNo: extraction.rollNo,
          extractionErrors: extraction.errors.map((e) => e.code),
          evidence,
          verification: { verdict: comparison.verification, reason: comparison.reason },
          tamper,
          timings,
          extractTimings: extraction.timings,
        },
      });
      setRows([...next]);
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-[1640px] px-6 py-16">
      <h1 className="text-heading-md text-on-primary">tampering checks (dev scratch)</h1>
      <label className="mt-6 block">
        <span className="text-caption">Source map (JSON: file name → verifySource result)</span>
        <textarea
          data-testid="source-map"
          value={sourceMap}
          onChange={(e) => setSourceMap(e.target.value)}
          className="mt-2 block h-24 w-full bg-canvas-soft p-2 font-mono text-caption"
        />
      </label>
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
          <pre data-testid={`tamper-${row.fileName}`} className="overflow-x-auto text-caption">
            {JSON.stringify(row.out, null, 2)}
          </pre>
        </section>
      ))}
    </main>
  );
}
