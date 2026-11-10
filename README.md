# VeriCert

PICT · NPTEL certificate verification. Staff upload a folder of NPTEL certificates; the app reads
each one, checks it against NPTEL's own verification source, runs tampering checks, and lets the
user export a CSV. Only verified `@pict.edu` accounts can use it.

> **Status: Phase 4 of 10 (tampering checks).** The browser can read a certificate (PDF, JPG or
> PNG) and run the tampering checks, and `POST /api/verify` can fetch NPTEL's values for a QR URL; that endpoint is temporarily
> unauthenticated and enabled only in dev or on a Vercel Preview. There is no sign-in or upload page yet. See `docs/progress.md` for the current
> state, `docs/implementation_plan.md` for the plan, and `CLAUDE.md` for the rules.

Uploaded certificate files never leave the browser. Only the verification URL, the extracted
fields and the check results reach the server.

## Stack

JavaScript (no TypeScript) · Next.js App Router on Vercel · MongoDB Atlas (`mongodb` driver) ·
Auth.js · Tailwind CSS v4 (tokens from `DESIGN.md`) · Vitest · Playwright. Every dependency is
pinned to an exact version; versions are recorded in `docs/progress.md`.

## Setup

Requires Node 24.

```bash
npm ci
cp .env.example .env     # then fill in the values below
npm run db:indexes       # creates the MongoDB indexes (safe to re-run)
npm run dev              # http://localhost:3000
```

`npm run dev` and `npm run build` first copy the pdf.js, zxing-wasm and tesseract.js workers, wasm and
language data into `public/vendor/` (gitignored, about 19 MB) so certificate processing makes no
third-party requests. For the browser tests run `npx playwright install chromium` once.

Check the database connection: `curl http://localhost:3000/api/health` should return
`{"ok":true,"db":"up","version":"…"}`. If the database is unreachable or a variable is missing it
returns HTTP 503 with `"db":"down"` (it never prints the reason; see the server log).

## Environment variables

Defined in `.env.example` (each has a one-line comment). `.env` is gitignored; set the same names
in Vercel for Preview and Production.

| Variable                                       | Needed from | Notes                                                          |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------- |
| `MONGODB_URI`, `MONGODB_DB`                    | Phase 1     | Both required; the app refuses to start a connection without them |
| `AUTH_SECRET`, `AUTH_URL`                      | Phase 5     |                                                                |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`         | Phase 5     | Google Cloud Console OAuth client                              |
| `RESEND_API_KEY`, `EMAIL_FROM`                 | Phase 5     |                                                                |
| `ALLOWED_EMAIL_DOMAIN`, `ADMIN_EMAILS`         | Phase 5     |                                                                |
| `VERCEL_AUTOMATION_BYPASS_SECRET`              | Phase 3     | Local `.env` only, for `npm run smoke:nptel` against a Preview |
| `SMOKE_SESSION_COOKIE`                         | Phase 5     | Local `.env` only: a real session cookie for `smoke:nptel` (see below) |
| `AUTH_EMAIL_STUB`                              | Phase 5     | Local/test only: write emails to `tmp/mail-outbox.jsonl`. Refused in production and on Vercel |

`VERIFY_DEV_ENDPOINT` no longer exists (Phase 3's temporary switch). If it is still set in Vercel, delete it.

### Refreshing `SMOKE_SESSION_COOKIE`

`npm run smoke:nptel -- --base-url=https://<deployment>` calls `/api/verify`, which needs a signed-in user.

1. Open the deployment in your browser (a Preview needs your Vercel login first) and sign in as your own `@pict.edu` account.
2. DevTools → Application → Cookies → the deployment's origin. Copy the **value** of `__Secure-authjs.session-token`.
3. Put it in your local `.env` as one line: `SMOKE_SESSION_COOKIE=__Secure-authjs.session-token=<value>` (on plain http, the cookie is called `authjs.session-token`).
4. Sessions last 7 days. When the script says the cookie was refused, repeat. Signing out in the browser revokes it at once.

The script sends it only as a `Cookie` header and never prints it. It is a real session: treat it like a password, and never commit or share it.
| `RATE_LIMIT_VERIFY_PER_MIN`                    | Phase 8     |                                                                |
| `RESULT_RETENTION_DAYS`                        | Phase 1     | Read by `npm run db:indexes` (TTL); default 180                |

## Commands

| Command              | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Local dev server                                                     |
| `npm test`           | Vitest unit tests                                                    |
| `npm run test:e2e`   | Playwright (starts `next dev` unless one is already on :3000)        |
| `npm run lint`       | ESLint and Prettier check                                            |
| `npm run format`     | Prettier write                                                       |
| `npm run build`      | Production build (must pass before a phase is complete)              |
| `npm run db:indexes` | Create/update all MongoDB indexes, including TTL changes             |
| `npm run smoke:nptel` | LIVE test against NPTEL (not in CI). `-- --base-url=https://<preview>` tests a deployment's `/api/verify`; needs the gitignored `samples/smoke.expected.local.json` |

First time only: `npx playwright install chromium`. The real-sample e2e tests read `samples/` and
`samples/expected.local.json` (both gitignored, never committed) and are skipped when absent.

## Layout

```
app/                 Next.js routes (pages and api/)
src/lib/db/          client.js (cached MongoClient), indexes.js
src/lib/extract/     browser extraction engine: index.js (extractCertificate), pdf.js, qr.js,
                     ocr.js, image.js, vendor.js, and parse.js (pure; shared with the server later)
src/lib/verify/      server: fetchSource.js (allowlisted fetch), parseSource.js, readPdf.js (unpdf),
                     dedupe.js, index.js (verifySource)
src/lib/compare.js   marks (±0.01) and name/course checks
src/lib/tamper/      checks.js (six checks and the verdict), metadata.js (raw PDF bytes), config.js (every threshold,
                     each with its evidence); pure, no browser APIs
src/lib/version.js   build version shown by /api/health
app/dev/extract/, app/dev/tamper/   dev-only scratch pages for the browser tests (404 in production)
scripts/             db-indexes.mjs, copy-vendor.mjs
tests/unit/          Vitest · tests/fixtures/ anonymised data (see its README)
e2e/                 Playwright
docs/                progress.md, challenges-log.md, implementation_plan.md
NOTES.md             Phase 0 findings about NPTEL's formats
```

Later phases fill in the rest of the layout described in `CLAUDE.md`.

## Deploying

Vercel (Hobby) with the GitHub repo imported; preview deploys on every push. Add `MONGODB_URI`
and `MONGODB_DB` for Preview and Production, then check `<deployment-url>/api/health`.

`vercel.json` pins the serverless functions to `bom1` (Mumbai), next to the Atlas cluster and NPTEL's servers.

The README's architecture diagram, NPTEL-format update guide and runbook are written in Phase 10.
