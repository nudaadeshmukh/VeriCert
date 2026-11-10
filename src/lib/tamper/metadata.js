// Raw PDF metadata, read from the BYTES. PURE: bytes in, facts out. No thresholds, no verdicts:
// those live in config.js and checks.js.
//
// Why raw bytes and not only pdf.js: the genuine Jul–Sep 2026 NPTEL PDF keeps its Producer in an
// `/Info` dictionary referenced from the Catalog, not from the trailer, so pdf.js `getMetadata()`
// reports no Producer at all (NOTES.md §1.1, C-001). A raw scan sees it. pdf.js' own `info` is
// accepted as a fallback for files whose Info sits in a compressed object stream.
//
// Reading the bytes needs a copy that pdf.js has not detached (CLAUDE.md known fact): `readPdf`
// in src/lib/extract/pdf.js keeps one.

/** @typedef {{ value: string, offset: number }} Found */

const latin1 = (/** @type {Uint8Array} */ bytes) => {
  // Chunked: String.fromCharCode(...bigArray) overflows the stack on multi-MB PDFs.
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};

/**
 * Decode a PDF text string: UTF-16BE with a BOM, or PDFDocEncoding (treated as Latin-1 here).
 * @param {string} s
 */
function decodeTextString(s) {
  if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < s.length; i += 2)
      out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    return out;
  }
  return s;
}

/**
 * Parse a PDF literal string starting at `(`; returns [decoded, indexAfter] or null.
 * @param {string} raw
 * @param {number} start index of "("
 */
function parseLiteral(raw, start) {
  let depth = 0;
  let out = '';
  for (let i = start; i < raw.length && i < start + 4096; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[++i];
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n === '\r' || n === '\n') {
        /* line continuation */
      } else out += n;
    } else if (c === '(') {
      if (depth++ > 0) out += c;
    } else if (c === ')') {
      if (--depth === 0) return [decodeTextString(out), i + 1];
      out += c;
    } else out += c;
  }
  return null;
}

/**
 * Value of a name key (`/Producer`) wherever it appears: literal string, hex string, or an
 * indirect reference to an object holding one. Every occurrence is returned, in file order, so
 * an incremental update that rewrote the Info dictionary is visible.
 *
 * @param {string} raw whole file as Latin-1
 * @param {string} key without the slash
 * @returns {Found[]}
 */
function findStringValues(raw, key) {
  /** @type {Found[]} */
  const found = [];
  const re = new RegExp(`/${key}(?![A-Za-z])\\s*`, 'g');
  for (const m of raw.matchAll(re)) {
    let i = m.index + m[0].length;
    const c = raw[i];
    if (c === '(') {
      const lit = parseLiteral(raw, i);
      if (lit) found.push({ value: lit[0], offset: m.index });
    } else if (c === '<' && raw[i + 1] !== '<') {
      const end = raw.indexOf('>', i);
      if (end > 0 && end - i < 8192) {
        const hex = raw.slice(i + 1, end).replace(/\s+/g, '');
        if (/^[0-9a-fA-F]*$/.test(hex)) {
          let bin = '';
          for (let k = 0; k < hex.length; k += 2)
            bin += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
          found.push({ value: decodeTextString(bin), offset: m.index });
        }
      }
    } else {
      const ref = /^(\d+)\s+(\d+)\s+R/.exec(raw.slice(i, i + 24));
      if (ref) {
        const obj = new RegExp(`(?:^|[\\r\\n])${ref[1]}\\s+${ref[2]}\\s+obj\\s*\\(`).exec(raw);
        if (obj) {
          const lit = parseLiteral(raw, obj.index + obj[0].length - 1);
          if (lit) found.push({ value: lit[0], offset: m.index });
        }
      }
    }
  }
  return found;
}

/**
 * PDF date `D:YYYYMMDDHHmmSSOHH'mm'` → Date, or null when it does not parse.
 * @param {string | undefined} s
 * @returns {Date | null}
 */
export function parsePdfDate(s) {
  if (!s) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?$/.exec(
    s.trim(),
  );
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z, sign, oh = '00', om = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (!z && sign) t -= (sign === '+' ? 1 : -1) * (+oh * 60 + +om) * 60_000;
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Text between `<tag>` and `</tag>` of an uncompressed XMP packet. */
function xmpValue(raw, tag) {
  const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(raw);
  return m ? m[1].trim() : undefined;
}

/**
 * @param {Uint8Array} bytes the PDF (an intact copy)
 * @param {{ Producer?: string, Creator?: string, CreationDate?: string, ModDate?: string } | null} [pdfjsInfo]
 *   `getMetadata().info` from pdf.js, used only where the raw scan finds nothing
 * @returns {{
 *   size: number, header: string, linearized: boolean, encrypted: boolean,
 *   eofCount: number, startxrefCount: number, xrefTableCount: number, xrefStreamCount: number, prevCount: number,
 *   producer?: string, creator?: string, creationDate?: string, modDate?: string,
 *   creationDateParsed: Date | null, modDateParsed: Date | null,
 *   allProducers: string[], allCreators: string[], xmpProducer?: string, xmpCreatorTool?: string,
 *   fromPdfjs: string[],
 * }}
 */
export function readPdfMetadata(bytes, pdfjsInfo = null) {
  const raw = latin1(bytes);
  const count = (/** @type {RegExp} */ re) => [...raw.matchAll(re)].length;
  const last = (/** @type {Found[]} */ f) => f.at(-1)?.value;

  const producers = findStringValues(raw, 'Producer');
  const creators = findStringValues(raw, 'Creator');
  const creations = findStringValues(raw, 'CreationDate');
  const mods = findStringValues(raw, 'ModDate');

  /** @type {string[]} */
  const fromPdfjs = [];
  const pick = (/** @type {string | undefined} */ rawValue, /** @type {string} */ key) => {
    if (rawValue !== undefined) return rawValue;
    const v = pdfjsInfo?.[key];
    if (typeof v === 'string' && v !== '') {
      fromPdfjs.push(key);
      return v;
    }
    return undefined;
  };
  const creationDate = pick(last(creations), 'CreationDate');
  const modDate = pick(last(mods), 'ModDate');

  return {
    size: bytes.length,
    header: raw
      .slice(0, 8)
      .replace(/[\r\n]/g, ' ')
      .trim(),
    linearized: raw.slice(0, 1024).includes('/Linearized'),
    encrypted: /\/Encrypt\s/.test(raw),
    eofCount: count(/(?:^|[\r\n])%%EOF[\r\n ]*/g),
    startxrefCount: count(/startxref\s+\d+/g),
    xrefTableCount: count(/(?:^|[\r\n])xref[\r\n]/g),
    xrefStreamCount: count(/\/Type\s*\/XRef/g),
    prevCount: count(/\/Prev\s+\d+/g),
    producer: pick(last(producers), 'Producer'),
    creator: pick(last(creators), 'Creator'),
    creationDate,
    modDate,
    creationDateParsed: parsePdfDate(creationDate),
    modDateParsed: parsePdfDate(modDate),
    allProducers: producers.map((p) => p.value),
    allCreators: creators.map((c) => c.value),
    xmpProducer: xmpValue(raw, 'pdf:Producer'),
    xmpCreatorTool: xmpValue(raw, 'xmp:CreatorTool'),
    fromPdfjs,
  };
}
