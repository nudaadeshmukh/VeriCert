# Challenges Log

History of everything that broke, surprised us, or forced a decision. Log entries **as they
happen**, not at the end of a phase. `docs/progress.md` is the current state; this file is
how we got there.

**Entry format:**
```
## C-00N — <short title>
**Phase:** N · **Date:** YYYY-MM-DD
**Symptom:** what was observed (exact error or measured numbers)
**Root cause:** what was actually wrong, found by measuring rather than guessing
**Fix:** what changed (file paths)
**Guard:** the test or check that now stops it recurring
```

---

## Carried over from the previous build (not yet re-verified)
- **pdf.js detached ArrayBuffer.** The metadata scan read a buffer pdf.js had already
  transferred to its worker, so every PDF failed in the browser while unit tests passed.
  Guard: copy the bytes, and run a Playwright test on real samples.
- **OCR false-positive tampering.** OCR read a name as "7", and that was flagged as a
  mismatch. Guard: malformed OCR output is `not_confirmed`.
- **Devanagari names rejected.** Vowel signs are combining marks. Guard: Unicode-aware
  normalisation, with a test fixture.
- **Windows line endings corrupted PDF fixtures.** Guard: `.gitattributes` with
  `*.pdf binary`.
- **NPTEL returned 500 on the first request.** It redirects from `nptel.ac.in` to
  `beta.nptel.ac.in`, and a retry with browser headers succeeds.
- **Near-blank PDFs took about 30 s of OCR each.** Guard: OCR crops only, with an 8 s
  budget per certificate.
