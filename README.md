# Tender Matcher

Pulls the latest active tenders from procurement portals (PPRA's EPADS for now), screens them against the Funavry profile with AI, reads the scanned tender PDFs for the likely matches, scores them, and shows the results on a login-protected dashboard (with Excel export).

Next.js 16 (App Router, TypeScript) on Vercel, Neon Postgres, and a durable background job (Vercel Workflow) behind the **Fetch** button.

## How it works

1. **Fetch** creates a `runs` row and starts the `fetchRunWorkflow` job. Only one run can be active (a database unique index enforces it).
2. The job scans each source newest-first and saves unseen tenders as `pending` rows, screens them in batches of 20 (`candidate` or `skipped`), then reads the PDFs and scores each candidate (`matched`).
3. Every step reads and writes Postgres, so a run that fails, is stopped, or hits an AI rate limit loses nothing; the next run finishes what is left. Rate limits become durable waits of exactly the time the provider asked for.
4. The dashboard polls the run and shows progress, logs and results. **Stop** ends the run before its next step.

## Setup

```bash
npm install
cp .env.example .env          # then fill it in (see below)
npx drizzle-kit migrate       # creates the tables in Neon (uses DIRECT_URL if set, else DATABASE_URL)
npm run serve                 # builds and serves on http://localhost:3000
```

Needs Node 24. Use `npm run build && npm start`: `npm run dev` currently reloads in a loop with the Workflow plugin (known issue, production mode is fine).

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled). `DIRECT_URL` (non-pooled) is optional and used for migrations. |
| `SESSION_SECRET` | 32+ random characters; signs the login cookie. |
| `APP_EMAIL` | The one fixed login email. |
| `APP_PASSWORD_HASH` | Hash of the login password: `npx tsx scripts/hash-password.ts 'your password'` |
| `AI_PROVIDER` | `groq` (default), `openai` or `anthropic`, with the matching `*_API_KEY`. `TEXT_MODEL` / `VISION_MODEL` override the defaults in `src/ai/llm.ts`. |

The Groq free tier limits PDF reading to roughly 15 to 25 tenders a day; a paid key (OpenAI or Anthropic) removes that. When the quota runs out the job waits and resumes by itself.

## Importing the old app's data

```bash
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-state.ts path/to/old/data/state.json
```

Safe to repeat: it never overwrites a tender that is already matched.

## The company profile

`config/profile.md` is what the AI matches against (hardware supply is deliberately **not** a match). It is bundled with the deployment, so editing it means a redeploy.

## Adding a source

Create `src/sources/<name>/` exporting a `TenderSource` (see `src/sources/types.ts`: `listPage`, `getDetail`, `fileUrl`) and add it to the list in `src/sources/index.ts`. Nothing else changes. Add a saved-HTML fixture test like `tests/sources/ppra.test.ts`; sources break silently when a site changes its HTML.

## Security

Login rate limit (5 per 15 minutes per IP, 20 overall) in Postgres; signed HttpOnly SameSite=Strict session cookie; nonce-based CSP and security headers on every response; Origin checks and JSON-only bodies on state-changing routes; no CORS; generic 500s with secrets redacted from logs; PDF downloads capped at 40 MB. The Workflow flow route is the only path outside the login gate; on Vercel it is protected by Vercel's queue consumer security.

## Tests and CI

`npm test` (Vitest; database tests run against in-process Postgres, no Neon needed), `npm run lint`, `npm run typecheck`, `npm run audit`. GitHub Actions runs all four on every push.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for the step-by-step Vercel guide.

## Known limits

- Vercel caps the number of events (steps) in one Workflow run. A fetch with a very large "Scan up to" can exceed it (`MAX_EVENTS_EXCEEDED`); keep it to a few hundred per run (leftover work resumes on the next run) or set `WORKFLOW_VM=quickjs`.
- A run whose workflow is lost (for example a killed local server) stays `running` and blocks new fetches until closed manually (`update runs set status = 'cancelled' ...`). No automatic reaper yet.
- Rate limits for starting runs and exporting are per server instance; the login limit is the database-backed one.
- Whether `pdf-to-img` (pdf.js + native canvas) runs on Vercel's serverless runtime is unverified until the first deployment; if it does not, send the PDF straight to a PDF-capable model (the change is local to `src/ai/pdf.ts`).
- `npm audit` reports two moderate `uuid` findings pulled in by `exceljs`; the advisory does not apply (no `buf` argument is used).
