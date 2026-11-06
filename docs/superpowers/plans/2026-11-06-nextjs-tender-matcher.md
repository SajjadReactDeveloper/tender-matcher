# Tender Matcher on Next.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node tender matcher with a logged-in Next.js app on Vercel and Neon whose Fetch button runs a durable Vercel Workflow job.

**Architecture:** App Router UI and route handlers; Drizzle on Neon Postgres holds tenders, runs and logs; a Workflow orchestrates per-tender steps that call pluggable tender sources and a configurable AI client; one fixed login protects everything.

**Tech Stack:** Next.js (latest, 16.x), React, TypeScript strict, Drizzle ORM + `@neondatabase/serverless`, `workflow` SDK, Vitest, ExcelJS, zod, jose, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-06-nextjs-tender-matcher-design.md`

## Global Constraints

- Latest Next.js (16.4.5 on 2026-11-06), pinned exact at scaffold time; Node 24; TypeScript `strict: true`. Check Next 16 docs for renamed conventions (`middleware` is `proxy.ts`).
- Free tiers only: Vercel Hobby and Neon free. Nothing may need a paid plan.
- Work on branch `nextjs`; `main` keeps the old app until cutover (Task 11).
- One fixed login from env `APP_EMAIL` and `APP_PASSWORD_HASH`; session cookie HttpOnly, Secure, SameSite=Strict, signed with `SESSION_SECRET`.
- Unique tender key is (`source`, `external_id`). Screened-and-skipped tenders are rows with `decision = 'skipped'`.
- Security controls from the audit stay: origin check on state-changing routes, JSON content type, 1 KB body cap on JSON routes, nonce CSP and headers (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP `same-origin`, `Cache-Control: no-store` on API), no CORS headers, generic 500s with secrets redacted, PDF download cap 40 MB.
- Rate limits: login 5 failures per 15 minutes per IP (my call); export 10 per minute; run start 5 per minute.
- AI provider by env `AI_PROVIDER` = `groq` (default) | `openai` | `anthropic`; model overrides `TEXT_MODEL`, `VISION_MODEL`.
- Hardware supply is NOT a match in the company profile.
- No commit message may carry a Claude attribution line.

## Review Focus

1. Dashboard with zero tenders and with a run never started: shows the empty state, not an error.
2. PPRA returns HTML with no rows (site changed): the run fails with a clear "source returned no tenders" error, never "completed, 0 new".
3. Fetch clicked while a run is active: 409 and a toast; no second workflow starts.
4. Stop clicked mid-run: the run ends `cancelled` after the current step; no half-written tender.
5. AI returns malformed JSON or hits a rate limit: the step retries; the tender is not marked skipped; work already saved is kept.
6. Expired or tampered session cookie on an API call: 401 JSON, not a redirect to HTML; on a page: redirect to `/login`.
7. Corrigendum changes a known tender's closing date: the stored date updates on the next run.
8. Neon cold start (first query fails once): retried, not surfaced as a 500.

---

## File Structure

```
src/proxy.ts                       auth gate + CSP/headers for every request
src/app/layout.tsx, page.tsx       shell; dashboard
src/app/login/{page.tsx,actions.ts}
src/app/api/tenders/route.ts       GET list
src/app/api/export/route.ts        GET xlsx
src/app/api/runs/route.ts          POST start, GET current
src/app/api/runs/stop/route.ts     POST stop
src/lib/{env.ts,security.ts}       validated env; origin check, redact, headers
src/lib/auth/{password.ts,session.ts,rate-limit.ts}
src/db/{client.ts,schema.ts,queries.ts}   drizzle/ holds migrations
src/domain/types.ts                Tender, Verdict, Analysis, RunStatus
src/sources/{types.ts,index.ts,ppra/{index.ts,parse.ts}}  tests/fixtures/ppra/*.html
src/ai/{llm.ts,prompts.ts,pdf.ts}
src/jobs/{fetch-run.ts,steps.ts}   workflow + steps
src/components/*                   Dashboard, TenderList, Runway, RunBar, Toasts, Skeleton
scripts/{hash-password.ts,import-state.ts}
config/profile.md
.github/workflows/ci.yml, .env.example, README.md
legacy/                            old src/ and public/ moved here for porting, deleted in Task 11
```

---

### Task 1: Scaffold, tooling and CI

**Files:** Create the Next.js app at repo root (via `create-next-app`, TypeScript, App Router, ESLint, `src/` dir, no Tailwind); move old `src/`, `public/`, `start.bat` into `legacy/`; Create `vitest.config.ts`, `.env.example`, `.github/workflows/ci.yml`; Modify `package.json` scripts, `.gitignore`.

**Interfaces:** Produces npm scripts `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `audit` (`npm audit --omit=dev --audit-level=high`).

- [ ] **Step 1:** Create branch `nextjs`. Move old app files into `legacy/` with `git mv`.
- [ ] **Step 2:** Scaffold Next.js latest, pin exact version in `package.json`. Add `vitest`, `zod`, `jose`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `exceljs`, `cheerio`, `workflow`, `pdf-to-img`.
- [ ] **Step 3:** Write `tests/smoke.test.ts` asserting `1 + 1 === 2`; run `npm test`, expect PASS (proves the runner works).
- [ ] **Step 4:** `.env.example` lists every variable: `DATABASE_URL`, `SESSION_SECRET`, `APP_EMAIL`, `APP_PASSWORD_HASH`, `AI_PROVIDER`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TEXT_MODEL`, `VISION_MODEL`.
- [ ] **Step 5:** CI workflow runs `npm ci`, `lint`, `typecheck`, `test`, `audit` on push and PR.
- [ ] **Step 6:** Run `npm run build`; expect success. Commit.

### Task 2: Env validation and database

**Files:** Create `src/lib/env.ts`, `src/db/client.ts`, `src/db/schema.ts`, `drizzle.config.ts`; Test `tests/env.test.ts`.

**Interfaces:**
- Produces `env: { DATABASE_URL: string; SESSION_SECRET: string; APP_EMAIL: string; APP_PASSWORD_HASH: string; AI_PROVIDER: 'groq'|'openai'|'anthropic'; ... }` from `getEnv(source = process.env)` (zod; throws listing every missing variable name, never values).
- Produces `db` (Drizzle client) and tables `tenders`, `runs`, `runLogs`, `loginAttempts` per the spec's data model; `tenders` has unique index on (`source`, `externalId`).

- [ ] **Step 1:** Test: `getEnv({})` throws an error whose message names `DATABASE_URL` and `SESSION_SECRET` but contains no values; `getEnv` with a short `SESSION_SECRET` (<32 chars) throws.
- [ ] **Step 2:** Implement `getEnv`; run test, expect PASS.
- [ ] **Step 3:** Define the schema; generate the first migration with `drizzle-kit generate`; apply to a Neon dev branch (`DATABASE_URL`).
- [ ] **Step 4:** Add `withRetry<T>(fn: () => Promise<T>): Promise<T>` in `src/db/client.ts` retrying connection errors twice (Neon cold start). Test with a function failing once then succeeding. Commit.

### Task 3: Domain types and the PPRA source

**Files:** Create `src/domain/types.ts`, `src/sources/types.ts`, `src/sources/index.ts`, `src/sources/ppra/{parse.ts,index.ts}`; Test `tests/sources/ppra.test.ts`; fixtures `tests/fixtures/ppra/{listing.html,detail.html,empty.html}` (saved from the live site; strip any contact data not needed).

**Interfaces:**
- `interface TenderSource { id: string; name: string; listPage(page: number): Promise<{ total: number; tenders: ListedTender[] }>; getDetail(externalId: string): Promise<TenderDetail> }`
- `ListedTender`: externalId, title, note, description, sector, refNo, status, corrigendum, advertised, closing, closingTime, organization, office, location, type, category, nature, url (all strings; dates `YYYY-MM-DD`).
- `TenderDetail`: contactPerson, contactEmail, contactPhone, procedure, bidSecurity, bidValidity, links `{ advertisement?: string; tenderDocument?: string }`.
- `sources: TenderSource[]` registry in `src/sources/index.ts`.
- `parseListing(html: string): { total: number; tenders: ListedTender[] }` and `parseDetail(html: string): TenderDetail` in `parse.ts`.

- [ ] **Step 1:** Tests: `parseListing(listing.html)` returns 50 tenders, first has a non-empty `externalId` matching `/^TS\d+E$/` and `closing` matching `/^\d{4}-\d{2}-\d{2}$/`; `parseListing(empty.html)` throws `SourceShapeError` ("source returned no tenders"); `parseDetail(detail.html)` returns `links.tenderDocument` starting `/pdf?file=`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Port `fetchListing`/`fetchDetail` from `legacy/src/ppra.js` into pure parsers plus a thin fetch layer (60 s timeout, 3 retries, 40 MB cap, User-Agent `tender-matcher`). Entity double-decoding from the legacy `clean` function must be kept.
- [ ] **Step 4:** Run tests, expect PASS. Commit.

### Task 4: AI client, prompts and PDF reading

**Files:** Create `src/ai/{llm.ts,prompts.ts,pdf.ts}`; Test `tests/ai/*.test.ts`.

**Interfaces:**
- `chat(opts: { system: string; user: string; images?: {b64: string; mime: string}[]; json?: boolean; maxTokens?: number }): Promise<string | unknown>` throwing `RateLimitError(retryAfterSeconds: number)` on 429 and `AiError` otherwise (messages redacted).
- `screenBatch(batch: ListedTender[], profile: string): Promise<Map<string, { relevant: boolean; reason: string }>>`
- `analyse(t: ListedTender, d: TenderDetail, docText: string, profile: string): Promise<Analysis>` with `Analysis = { relevance: 'High'|'Medium'|'Low'; score: number; recommendation: string; challenges: string; scope: string }`.
- `readDocuments(links: TenderDetail['links'], maxPages: number): Promise<{ text: string; pages: number }>` (renders PDFs to images, sends to the vision model).
- `parseJsonReply(text: string): unknown` and `redact(s: string): string` (also exported to `src/lib/security.ts`).

- [ ] **Step 1:** Tests: `parseJsonReply('<think>x</think>{"a":1}')` equals `{a:1}`; `parseJsonReply('no json')` throws; `analyse` rejects replies where `score` is not 0–100 or `relevance` is not one of the three values (zod); `redact` removes an env key value and `sk-`/`gsk_` shaped tokens; `chat` with a mocked `fetch` returning 429 and `retry-after: 37` throws `RateLimitError` with 37.
- [ ] **Step 2:** Run, expect FAIL. Implement by porting `legacy/src/llm.js` and the prompts in `legacy/src/pipeline.js`, validating AI JSON with zod.
- [ ] **Step 3:** Run tests, expect PASS. Commit.
- [ ] **Step 4 (spike, report result):** deploy a throwaway preview that renders one PDF page through `pdf-to-img` on Vercel. If it fails, implement the fallback in `readDocuments` (send the PDF directly to a PDF-capable model) and record the decision in the README.

### Task 5: Authentication

**Files:** Create `src/lib/auth/{password.ts,session.ts,rate-limit.ts}`, `src/app/login/{page.tsx,actions.ts}`, `scripts/hash-password.ts`; Test `tests/auth/*.test.ts`.

**Interfaces:**
- `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>` (scrypt, constant-time compare; hash format `scrypt$N$salt$hash`).
- `createSession(email: string): Promise<string>` (signed JWT, 7-day expiry) and `verifySession(token: string | undefined): Promise<{ email: string } | null>`.
- `checkLoginAllowed(ip: string): Promise<boolean>` and `recordLoginFailure(ip: string): Promise<void>` using `loginAttempts`.
- `loginAction(formData: FormData): Promise<{ error?: string }>`; `logoutAction()`.

- [ ] **Step 1:** Tests: a hash verifies for the right password and fails for a wrong one; `verifySession` returns null for a tampered token, an expired token and `undefined`; after 5 recorded failures `checkLoginAllowed` is false, and true again for a different IP.
- [ ] **Step 2:** Run, expect FAIL; implement; run, expect PASS.
- [ ] **Step 3:** Login page (email, password, error message, submit disabled while pending). `loginAction` compares email in constant time, verifies password, sets the cookie, redirects to `/`. Failure message is identical for wrong email and wrong password.
- [ ] **Step 4:** `scripts/hash-password.ts` prints a hash for a password given as argv; document in README. Commit.

### Task 6: Proxy, security headers and origin checks

**Files:** Create `src/proxy.ts`, `src/lib/security.ts`; Test `tests/security.test.ts`.

**Interfaces:**
- `securityHeaders(nonce: string): Record<string, string>` (CSP with the nonce, plus the headers in Global Constraints).
- `assertSameOrigin(req: Request): void` throwing `HttpError(403)` when `Origin` is present and differs from the request host, or `Sec-Fetch-Site` is not `same-origin`/`none`.
- `readJsonBody(req: Request, maxBytes = 1024): Promise<unknown>` throwing `HttpError(413|415|400)`.
- `HttpError(status: number, message: string)` and `errorResponse(e: unknown): Response` (generic 500, redacted log).
- `proxy(req)` redirects unauthenticated page requests to `/login` and returns 401 JSON for unauthenticated `/api/*`; sets headers on every response.

- [ ] **Step 1:** Tests: cross-origin `Origin` rejected; missing `Origin` allowed; body of 2 KB rejected 413; `text/plain` rejected 415; invalid JSON 400; `securityHeaders` contains `frame-ancestors 'none'` and the given nonce.
- [ ] **Step 2:** Run, expect FAIL; implement; run, expect PASS.
- [ ] **Step 3:** Manual check on `npm run dev`: unauthenticated `curl /api/tenders` returns 401 JSON; `curl /` redirects to `/login`. Commit.

### Task 7: Run orchestration (Workflow)

**Files:** Create `src/db/queries.ts`, `src/jobs/{fetch-run.ts,steps.ts}`, `src/app/api/runs/route.ts`, `src/app/api/runs/stop/route.ts`; Modify `next.config.ts` (`withWorkflow`); Test `tests/jobs/fetch-run.integration.test.ts` (Workflow Vitest plugin).

**Interfaces:**
- Queries: `createRun(limit: number): Promise<Run>` (throws `HttpError(409)` if a run is `queued`/`running`), `getCurrentRun()`, `appendLog(runId, message)`, `requestStop(runId)`, `isStopRequested(runId)`, `finishRun(runId, status, error?)`, `knownIds(source): Promise<Set<string>>`, `saveSkipped(...)`, `saveMatched(...)`, `updateClosingDates(...)`.
- Workflow: `fetchRunWorkflow(runId: string, limit: number): Promise<void>` (`"use workflow"`), orchestration only.
- Steps (`"use step"`): `scanSource(runId, sourceId, limit): Promise<ListedTender[]>`, `screenBatchStep(runId, batch): Promise<ListedTender[]>` (returns the relevant ones), `analyseTenderStep(runId, t): Promise<void>`. A `RateLimitError` becomes `RetryableError` with `retryAfter`; a stop request makes the step return early and the workflow end `cancelled`.
- Routes: `POST /api/runs` body `{ limit: number }` (1–3000), origin-checked, rate limited, returns `{ runId }`; `GET /api/runs/current` returns run plus last 300 log lines; `POST /api/runs/stop`.

- [ ] **Step 1:** Integration tests with a fake source and a fake AI client: (a) a 45-tender source with 3 relevant yields 3 matched and 42 skipped rows; (b) a second run skips all known ids and only updates a changed closing date; (c) a fake AI that throws `RateLimitError` once then succeeds still saves the tender and the run completes; (d) `requestStop` mid-run ends `cancelled` with no partial tender row; (e) a source returning `SourceShapeError` ends `failed` with that message; (f) `createRun` while one is active throws 409.
- [ ] **Step 2:** Run, expect FAIL; implement; run, expect PASS.
- [ ] **Step 3:** Deploy a preview, click through with `curl` and confirm the run row advances and logs appear. Commit.

### Task 8: Tenders API and Excel export

**Files:** Create `src/app/api/tenders/route.ts`, `src/app/api/export/route.ts`, `src/lib/xlsx.ts`; Test `tests/export.test.ts`.

**Interfaces:** `GET /api/tenders?source=` returns matched tenders sorted by posting date descending; `buildXlsx(tenders: Tender[]): Promise<ArrayBuffer>` with the same eleven columns and widths as `legacy/src/store.js`; `GET /api/export` rate limited, `Content-Disposition: attachment; filename="tenders.xlsx"`.

- [ ] **Step 1:** Tests: workbook has header row `Posting Date` … `PPRA Link`, one row per tender, a cell starting with `=` is stored as text, and 11th request in a minute returns 429.
- [ ] **Step 2:** Run, expect FAIL; implement; run, expect PASS. Commit.

### Task 9: Dashboard UI

**Files:** Create `src/components/*`, port the CSS from `legacy/public/index.html` into `src/app/globals.css`; Modify `src/app/page.tsx`; Test `tests/ui/*.test.tsx` (Vitest + Testing Library).

**Interfaces:** Components `Dashboard` (client; owns filters, polling every 2.5 s while a run is active), `TenderList`, `Runway`, `RunBar`, `Toasts` with `useToast(): { toast(msg: string, kind?: 'ok'|'err'): void }`, `Skeleton`. Pure helpers `daysLeft`, `verdictOf`, `whyOf` in `src/components/format.ts`.

- [ ] **Step 1:** Tests: `verdictOf({ recommendation: 'Bid – fits' })` is `Bid`; `daysLeft` of today is 0; `TenderList` with `[]` renders the empty-state text, with `loading` renders skeleton rows, with `error` renders a Retry button that calls `onRetry`; clicking Fetch with limit `0` shows an error toast and makes no request; a 409 from the API shows its message as an error toast.
- [ ] **Step 2:** Run, expect FAIL; implement by porting the legacy page behaviour (filters, search, sort, runway SVG, detail panel, theme toggle, toasts on run start/finish/stop/download, reconnect toast); run, expect PASS.
- [ ] **Step 3:** Hide the source filter when only one source exists. Verify in a browser: loading skeleton, empty state, error state, a finished run toast. Commit.

### Task 10: Data import and profile update

**Files:** Create `scripts/import-state.ts`; Modify `config/profile.md`; Test `tests/import.test.ts`.

**Interfaces:** `importState(state: LegacyState, source = 'ppra'): Promise<{ matched: number; skipped: number }>` (idempotent: running twice adds nothing).

- [ ] **Step 1:** Test with a fixture state of 2 matched and 3 seen ids: first call returns `{ matched: 2, skipped: 3 }`, second returns `{ matched: 0, skipped: 0 }`.
- [ ] **Step 2:** Run, expect FAIL; implement (legacy `seen` entries not in `tenders` become `skipped`, keeping their title and reason); run, expect PASS.
- [ ] **Step 3:** Edit the profile: remove the hardware-supply line from "Tenders we want" and add to "Not a match": hardware supply, networking or connectivity services, equipment maintenance, software licence resale.
- [ ] **Step 4:** Run the import against the Neon database from the current `data/state.json`; confirm counts (15 matched, the rest skipped). Commit.

### Task 11: Deploy and cutover

**Files:** Modify `README.md`; Delete `legacy/` and root `start.bat` after verification.

- [ ] **Step 1:** Create the Vercel project from the GitHub repo; set all env vars; connect the Neon database; deploy the `nextjs` branch as a preview.
- [ ] **Step 2:** Verify on the preview: login works and a wrong password is rejected; dashboard shows the imported tenders; Fetch with limit 5 completes and adds rows; Stop works; Excel downloads; response headers match the spec; `npm run audit` passes.
- [ ] **Step 3:** README documents setup, env vars, hashing a password, importing data, and the PDF fallback decision.
- [ ] **Step 4:** Ask the owner to approve cutover; then delete `legacy/`, merge `nextjs` into `main`, promote to production. (Pushing and merging require the owner's explicit go-ahead.)
