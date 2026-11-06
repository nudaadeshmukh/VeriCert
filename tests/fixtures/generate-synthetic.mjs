// Generates SYNTHETIC fixtures (no real student data). Run: node tests/fixtures/generate-synthetic.mjs
// Everything here is invented. Real-sample-derived fixtures were anonymised separately (see README.md).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const w = (f, o) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o, null, 2) + '\n'); };

// Layout copied from the genuine 2026 sample (text-layer order: name, course, total, assignment, exam, candidates, session, weeks, credits, roll).
const cert = ({ name, course, total = '91%', a = '25/25', e = '66/75', session = 'JUL-SEP 2026', roll = 'NPTEL26HS164S000000002' }) => ({
  page: { width: 841.92, height: 595.44 },
  items: [
    { str: name, x: 311, y: 398 }, { str: course, x: 264, y: 331 }, { str: total, x: 487, y: 295 },
    { str: a, x: 371, y: 262 }, { str: e, x: 569, y: 262 }, { str: '1910', x: 550, y: 229 },
    { str: session, x: 371, y: 134 }, { str: '(8 week course)', x: 379, y: 119 },
    { str: 'No. of credits recommended: 3', x: 622, y: 19 }, { str: `Roll No: ${roll}`, x: 41, y: 19 },
  ],
});
const variants = {
  'variant-decimal-marks': [{ name: 'MEERA SUNIL JOSHI', course: 'DATA ANALYTICS WITH PYTHON', total: '53%', a: '12.25/25', e: '40.5/75' }, { assignment: 12.25, exam: 40.5 }],
  'variant-long-name': [{ name: 'VENKATARAMANAN SUBRAMANIAM PADMANABHAN IYENGAR-KRISHNAMURTHY', course: 'INTRODUCTION TO MACHINE LEARNING', a: '24/25', e: '70/75' }, { assignment: 24, exam: 70 }],
  // Devanagari vowel signs / virama are combining marks (U+093E.. U+094D); a \p{L}-only "is a real name" check would reject these.
  'variant-devanagari-name': [{ name: 'आशा रमेश कुलकर्णी', course: 'PROGRAMMING IN JAVA', a: '22/25', e: '60/75' }, { assignment: 22, exam: 60 }],
  // nukta written decomposed (U+091C U+093C) vs precomposed (U+095B, composition-excluded): NFC must treat both identically.
  'variant-devanagari-nukta-decomposed': [{ name: 'ज\u093Cीनत शेख', course: 'PROGRAMMING IN JAVA', a: '20/25', e: '55/75' }, { assignment: 20, exam: 55 }],
  'variant-long-course-name': [{ name: 'RAHUL ANIL PATIL', course: 'INTRODUCTION TO PROFESSIONAL ETHICS, CORPORATE GOVERNANCE AND SUSTAINABLE BUSINESS PRACTICES', a: '18/25', e: '52/75' }, { assignment: 18, exam: 52 }],
  'variant-zero-marks': [{ name: 'SNEHA DILIP MORE', course: 'EFFECTIVE WRITING', total: '0%', a: '0/25', e: '0/75' }, { assignment: 0, exam: 0 }],
  // Out of range: parse.js must reject (assignment max 25, exam max 75).
  'variant-out-of-range': [{ name: 'KIRAN ASHOK DESAI', course: 'EFFECTIVE WRITING', a: '26/25', e: '80/75' }, { error: 'out_of_range' }],
  // What OCR could plausibly produce (O for 0, l for 1, S for 5, spaces around "/"): parse.js must tolerate these.
  'variant-ocr-slips': [{ name: 'KIRAN ASHOK DESAI', course: 'EFFECTIVE WRITING', a: '2O / 25', e: '6l.88/7S' }, { assignment: 20, exam: 61.88 }],
};
for (const [k, [args, expected]] of Object.entries(variants))
  w(`text/${k}-text.json`, { _note: `SYNTHETIC. ${k}. All values invented.`, ...cert(args), expected });

// "Edited marks": certificate shows full marks, NPTEL source (below) shows the real ones -> Verification must be Unsuccessful.
w('text/variant-edited-marks-text.json', { _note: 'SYNTHETIC. Certificate claims 25/25 and 75/75; source says 18/25 and 52/75.', ...cert({ name: 'RAHUL ANIL PATIL', course: 'EFFECTIVE WRITING', total: '100%', a: '25/25', e: '75/75' }), expected: { assignment: 25, exam: 75, verification: 'Unsuccessful' } });
w('source-pdf-text/variant-edited-marks-source-text.json', { _note: 'SYNTHETIC source (NPTEL side) for variant-edited-marks.', ...cert({ name: 'RAHUL ANIL PATIL', course: 'EFFECTIVE WRITING', total: '70%', a: '18/25', e: '52/75' }) });

// ---- Minimal hand-built PDFs (Helvetica, one page) so metadata checks have real files to chew on ----
function buildPdf({ lines, info }) {
  const objs = [];
  const content = lines.map(([t, x, y]) => `BT /F1 14 Tf ${x} ${y} Td (${t.replace(/[()\\]/g, (c) => '\\' + c)}) Tj ET`).join('\n');
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[2] = '<</Type/Pages/Count 1/Kids[3 0 R]>>';
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>';
  objs[4] = `<</Length ${content.length}>>\nstream\n${content}\nendstream`;
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  if (info) objs[6] = `<<${Object.entries(info).map(([k, v]) => `/${k}(${v})`).join('')}>>`;
  let out = '%PDF-1.4\n'; const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length; const n = objs.length;
  out += `xref\n0 ${n}\n0000000000 65535 f \n` + off.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<</Size ${n}/Root 1 0 R${info ? '/Info 6 0 R' : ''}>>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
const genuineLines = [['ASHA RAMESH KULKARNI', 311, 398], ['DATA ANALYTICS WITH PYTHON', 264, 331], ['53%', 487, 295], ['12.25/25', 371, 262], ['40.5/75', 569, 262], ['Roll No: NPTEL25MG18S000000003', 41, 19]];
const genuine = buildPdf({ lines: genuineLines, info: { Producer: 'FPDF 1.81', CreationDate: 'D:20250331193315' } });
w('pdf/synthetic-genuine-style.pdf', genuine);

// Tampered: same file, then an INCREMENTAL UPDATE that (a) replaces the content stream with edited marks and
// (b) replaces Info with an editor Producer and a ModDate months after CreationDate. Result: 2 x %%EOF, 2 x startxref.
const edited = genuineLines.map(l => l[0] === '12.25/25' ? ['25/25', 371, 262] : l[0] === '40.5/75' ? ['75/75', 569, 262] : l);
const newContent = edited.map(([t, x, y]) => `BT /F1 14 Tf ${x} ${y} Td (${t}) Tj ET`).join('\n');
const base = genuine; let upd = '';
const o4 = base.length + upd.length; upd += `4 0 obj\n<</Length ${newContent.length}>>\nstream\n${newContent}\nendstream\nendobj\n`;
const o6 = base.length + upd.length; upd += `6 0 obj\n<</Producer(Adobe Acrobat Pro DC 23.1)/CreationDate(D:20250331193315)/ModDate(D:20250920101500)>>\nendobj\n`;
const x2 = base.length + upd.length;
const prev = Number(/startxref\n(\d+)/.exec(base)[1]);
upd += `xref\n0 1\n0000000000 65535 f \n4 1\n${String(o4).padStart(10, '0')} 00000 n \n6 1\n${String(o6).padStart(10, '0')} 00000 n \ntrailer\n<</Size 7/Root 1 0 R/Info 6 0 R/Prev ${prev}>>\nstartxref\n${x2}\n%%EOF\n`;
w('pdf/synthetic-tampered-metadata.pdf', base + upd);
console.log('synthetic fixtures written');
