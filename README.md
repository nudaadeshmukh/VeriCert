# VeriCert

PICT · NPTEL certificate verification. Staff upload a folder of NPTEL certificates; the app reads
each one, checks it against NPTEL's own verification source, runs tampering checks, and lets the
user export a CSV. Only verified `@pict.edu` accounts can use it.

> **Status: Phase 1 of 10 (project foundation).** The site is an empty shell with a database
> connection. Sign-in and verification are not built yet. See `docs/progress.md` for the current
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

First time only: `npx playwright install chromium`.

## Layout

```
app/                 Next.js routes (pages and api/)
src/lib/db/          client.js (cached MongoClient), indexes.js
src/lib/version.js   build version shown by /api/health
scripts/             one-off Node scripts (db-indexes.mjs)
tests/unit/          Vitest · tests/fixtures/ anonymised data (see its README)
e2e/                 Playwright
docs/                progress.md, challenges-log.md, implementation_plan.md
NOTES.md             Phase 0 findings about NPTEL's formats
```

Later phases fill in the rest of the layout described in `CLAUDE.md`.

## Deploying

Vercel (Hobby) with the GitHub repo imported; preview deploys on every push. Add `MONGODB_URI`
and `MONGODB_DB` for Preview and Production, then check `<deployment-url>/api/health`.

The README's architecture diagram, NPTEL-format update guide and runbook are written in Phase 10.
