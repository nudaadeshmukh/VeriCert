# Test fixtures

No real student data. Everything here is anonymised or invented.

| Folder | Content | Origin |
|---|---|---|
| `text/genuine-*.json` | Text-layer dumps (string + position) of the two genuine PDFs | Real samples; name, roll number replaced |
| `source-pdf-text/2025-*`, `2026-*` | Text dump of the NPTEL-side PDF for each sample | Real; same replacements |
| `verify-html/` | Raw verification/landing pages for both URL shapes | Real HTML; certificate IDs and names replaced |
| `text/variant-*.json`, `source-pdf-text/variant-*` | Decimal marks, long name, Devanagari (incl. decomposed nukta), long course, zero marks, out-of-range, OCR slips, edited marks | **Synthetic** (`generate-synthetic.mjs`) |
| `pdf/synthetic-genuine-style.pdf` | One-page PDF, Producer `FPDF 1.81` + CreationDate, one `%%EOF` | **Synthetic** |
| `pdf/synthetic-tampered-metadata.pdf` | Same, plus an incremental update: edited marks, Producer `Adobe Acrobat Pro DC 23.1`, ModDate after CreationDate, two `%%EOF` | **Synthetic** |

Replacements used for the real-derived files: the candidate name became `ASHA RAMESH KULKARNI`;
roll numbers and certificate IDs became obvious placeholders (`…000000001`, `NOC-TEST-FIXT-URE01`)
with the same length and shape. Marks, course names, session labels and counts are as observed.

Each `variant-*` text file has an `expected` field the Phase 2 parser tests should assert.
Regenerate the synthetic files with `node tests/fixtures/generate-synthetic.mjs`. The real-derived
files cannot be regenerated without the private `samples/` and are committed as-is.

Fixtures are marked binary where needed in `.gitattributes` (`*.pdf`); the PDFs are byte-exact
(their xref offsets break if line endings change).
