// Runtime-generated synthetic certificates for the tampering tests (nothing real, nothing committed as a binary).
//
//   drawCertificate(page, values)   draws an NPTEL-style certificate on a canvas IN THE BROWSER (so the fonts are
//                                   real) and returns it as JPEG bytes. Same layout the OCR was tuned on: printed
//                                   boilerplate, name, course, and a 4-cell marks table with five equal-height borders.
//   buildImagePdf({ jpeg, ... })    a one-page PDF: the picture, plus an INVISIBLE text layer (render mode 3) that the
//                                   test controls. A text layer that matches the picture is what a genuine
//                                   "image with an OCR layer" looks like; one that does not is an edited text layer.
const W = 1054;
const H = 759;

/**
 * @param {import('@playwright/test').Page} page any page of the app (the canvas is drawn there)
 * @param {{ name: string, course: string, assignment: string, exam: string, total?: string }} v what is DRAWN
 * @returns {Promise<Buffer>} JPEG
 */
export async function drawCertificate(page, v) {
  const b64 = await page.evaluate(
    ({ v, W, H }) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#000';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const text = (s, x, y, font) => {
        g.font = font;
        g.fillText(s, x, y);
      };
      text('NPTEL ONLINE CERTIFICATION', 527, 85, 'bold 40px Georgia, serif');
      text('This certificate is awarded to', 527, 177, 'italic 22px Georgia, serif');
      text(v.name, 527, 214, 'bold 18px Arial, sans-serif');
      text('for successfully completing the course', 527, 248, 'italic 22px Georgia, serif');
      text(v.course, 527, 302, 'bold 22px Georgia, serif');
      text(`with a consolidated score of ${v.total ?? '70'} %`, 527, 365, 'italic 20px Georgia, serif');
      // the table: five vertical borders of equal height, like the real one
      g.lineWidth = 1;
      g.strokeStyle = '#000';
      g.strokeRect(238.5, 383.5, 562, 44);
      for (const x of [446.5, 537.5, 708.5]) {
        g.beginPath();
        g.moveTo(x, 383);
        g.lineTo(x, 427);
        g.stroke();
      }
      text('Online Assignments', 342, 405, '20px Georgia, serif');
      text(v.assignment, 491, 405, 'bold 16px Arial, sans-serif');
      text('Proctored Exam', 622, 405, '20px Georgia, serif');
      text(v.exam, 754, 405, 'bold 16px Arial, sans-serif');
      text(
        'Total number of candidates certified in this course: 1910',
        527,
        455,
        'italic 20px Georgia, serif',
      );
      text('Indian Institute of Technology', 527, 650, '20px Arial, sans-serif');
      return c.toDataURL('image/jpeg', 0.95).split(',')[1];
    },
    { v, W, H },
  );
  return Buffer.from(b64, 'base64');
}

/** @param {string} s */
const esc = (s) => s.replace(/[\\()]/g, (ch) => `\\${ch}`);

/**
 * @param {{ jpeg: Buffer, textItems: { text: string, x: number, y: number }[], producer?: string,
 *   creationDate?: string }} o  y is measured from the TOP of the 1054 x 759 picture
 * @returns {Buffer}
 */
export function buildImagePdf({
  jpeg,
  textItems,
  producer = 'FPDF 1.81',
  creationDate = 'D:20250331193315',
}) {
  /** @type {Buffer[]} */ const chunks = [];
  let len = 0;
  /** @type {number[]} */ const offsets = [];
  const push = (/** @type {string | Buffer} */ b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1');
    chunks.push(buf);
    len += buf.length;
  };
  const obj = (/** @type {number} */ n, /** @type {string} */ body) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, '<</Type/Pages/Count 1/Kids[3 0 R]>>');
  obj(
    3,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im0 5 0 R>>/Font<</F1 6 0 R>>>>/Contents 4 0 R>>`,
  );
  const content =
    `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\nBT 3 Tr\n` +
    textItems.map((t) => `/F1 14 Tf 1 0 0 1 ${t.x} ${H - t.y} Tm (${esc(t.text)}) Tj`).join('\n') +
    '\nET';
  obj(4, `<</Length ${content.length}>>\nstream\n${content}\nendstream`);
  offsets[5] = len;
  push(
    `5 0 obj\n<</Type/XObject/Subtype/Image/Width ${W}/Height ${H}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(6, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  obj(7, `<</Producer(${esc(producer)})/CreationDate(${creationDate})>>`);
  const xref = len;
  push(
    `xref\n0 8\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('')}`,
  );
  push(`trailer\n<</Size 8/Root 1 0 R/Info 7 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

/**
 * The hidden text layer of a certificate, laid out like the real ones (name above course above the marks row, the
 * bare total between them) so that `parseCertificateText` reads it.
 * @param {{ name: string, course: string, assignment: string, exam: string, total?: string }} v
 */
export function hiddenLayer(v) {
  return [
    { text: v.name, x: 400, y: 214 },
    { text: v.course, x: 400, y: 302 },
    { text: v.total ?? '70', x: 540, y: 365 },
    { text: v.assignment, x: 470, y: 405 },
    { text: v.exam, x: 735, y: 405 },
  ];
}
