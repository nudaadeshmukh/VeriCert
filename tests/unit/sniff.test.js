import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sniffType } from '../../src/lib/extract/index.js';

const pdf = (name) => new Blob([fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/pdf', name))]);
const bytes = (...b) => new Blob([new Uint8Array(b)]);

describe('sniffType (identifies files by their first bytes, not name or MIME type)', () => {
  it('PDF', async () => {
    expect(await sniffType(pdf('synthetic-genuine-style.pdf'))).toBe('pdf');
    expect(await sniffType(pdf('synthetic-tampered-metadata.pdf'))).toBe('pdf');
  });
  it('PNG and JPEG signatures', async () => {
    expect(await sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(await sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
  });
  it('refuses everything else, including text pretending to be an image', async () => {
    expect(await sniffType(new Blob(['this is plain text, not a PNG']))).toBeNull();
    expect(await sniffType(new Blob(['<html></html>']))).toBeNull();
    expect(await sniffType(new Blob([]))).toBeNull();
    expect(await sniffType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull(); // "%PDF" without the dash
  });
});
