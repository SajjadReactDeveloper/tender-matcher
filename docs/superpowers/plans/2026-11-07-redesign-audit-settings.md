# Redesign, Audit Log and AI Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, chosen by the user: "Native"). Steps use checkbox syntax.

**Goal:** Add an audit trail (AI calls with tokens, fetch requests, run/settings/auth events), dashboard-managed AI provider/model/keys (encrypted in Neon), run history and usage pages, and redesign the app into a sidebar layout.

**Architecture:** New tables `settings`, `api_keys`, `ai_calls`, `audit_events`. A request-scoped `AsyncLocalStorage` audit context (run id, tender id) lets `chat()` and `fetchBuffer()` record themselves without changing pipeline signatures. `chat()` resolves provider/model/key from the DB first, env second. New API routes and four App Router pages under a shared shell.

**Tech Stack:** Next.js 16.4.5, Drizzle + Neon, PGlite tests, Vitest, zod. No new runtime dependencies (Node `crypto` for AES-256-GCM).

**Spec:** `docs/superpowers/specs/2026-11-07-redesign-audit-settings-design.md`

## Global Constraints

- Every new route handler calls `requireSession(req)`; mutating routes also `assertSameOrigin`, `readJsonBody` (1 KB cap, 8 KB for key saves is NOT needed: keys are under 500 chars) and `rateLimit`.
- API keys: never returned, never logged, never put in `audit_events.details` or `ai_calls`; all stored text goes through `redact()`.
- Audit writes never throw into callers (`try/catch`, `console.error` the message only).
- Migrations are additive only. Generate with `npx drizzle-kit generate`; tests apply the real migrations.
- No new runtime dependencies. CSP stays nonce-based; no inline scripts.
- Existing 171 tests keep passing. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Text: UI copy plain and short; dates shown in the viewer's locale; tokens with thousands separators.

## Review Focus

- A key saved with `SETTINGS_ENCRYPTION_KEY` unset or malformed must fail with a clear 400/503, never store plaintext.
- A tampered or wrong-key ciphertext must read as "no key", not crash a run (falls back to env).
- A provider reply without `usage` stores null tokens, not 0.
- 429 and errored attempts are audited with the right status and `retry_after_s`.
- Audit insert failure must not fail the AI call, fetch or run.
- A settings change mid-run applies to the next call; the audit row records the model actually used.

---

### Task 1: Schema, migration and audit store

**Files:** Modify `src/db/schema.ts`; create `drizzle/0002_*.sql` (generated), `src/audit/context.ts`, `src/audit/store.ts`, `src/audit/pricing.ts`; tests `tests/audit/store.test.ts`, `tests/audit/pricing.test.ts`.

**Interfaces — Produces:**
- Tables: `settings(id pk=1, provider, textModel, visionModel, updatedAt)`, `apiKeys(provider pk, ciphertext, iv, tag, last4, updatedAt)`, `aiCalls(id, at, runId?, tenderExternalId?, purpose, provider, model, attempt, status 'ok'|'rate_limited'|'error', httpStatus?, inputTokens?, outputTokens?, totalTokens?, images, promptChars, replyChars, latencyMs, retryAfterS?, estCostUsd? (numeric as string), error?, promptPreview?, replyPreview?)`, `auditEvents(id, at, category 'fetch'|'run'|'settings'|'auth', action, status 'ok'|'error'|'info', runId?, ref?, durationMs?, details jsonb)`.
- `context.ts`: `type AuditCtx = { runId?: number; tender?: string }`; `withAudit<T>(ctx: AuditCtx, fn: () => Promise<T>): Promise<T>`; `getAudit(): AuditCtx`.
- `store.ts`: `recordEvent(e: { category; action; status?; runId?; ref?; durationMs?; details?: unknown }): Promise<void>`; `recordAiCall(c: NewAiCall): Promise<void>` (both swallow errors, redact strings, truncate previews to 4000 chars, details JSON to 8 KB); `pruneAudit(days = 180): Promise<void>`; `listAuditEvents(f: { category?; status?; runId?; q?; from?; to?; before?: number; limit?: number }): Promise<{ rows; next: number | null }>`; `listAiCalls(same filter shape)`; `usageSummary(sinceHours: number): Promise<{ calls; inputTokens; outputTokens; rateLimited; errors; estCostUsd; byModel: { provider; model; calls; inputTokens; outputTokens; estCostUsd }[] }>`.
- `pricing.ts`: `estimateCostUsd(provider, model, inputTokens, outputTokens): number | null` from a small table of USD per 1M tokens; `null` for unknown models or null tokens.

- [ ] Write failing tests: `recordEvent` then `listAuditEvents` returns it with secrets redacted (`sk-abc...` in details becomes `[redacted]`); a thrown DB error inside `recordEvent` does not reject; `recordAiCall` with null tokens stores null; `usageSummary(24)` sums tokens and groups by model; `pruneAudit(1)` removes a row dated 3 days ago and keeps a fresh one; `listAuditEvents({ before })` pages by id descending; `estimateCostUsd('openai','gpt-4.1-mini',1_000_000,0)` equals the table price and an unknown model returns `null`.
- [ ] Run `npx vitest run tests/audit` — expect FAIL (modules missing).
- [ ] Add the tables to `schema.ts` (indexes: `ai_calls(at)`, `ai_calls(run_id)`, `audit_events(at)`, `audit_events(category, at)`); run `npx drizzle-kit generate --name audit_settings`.
- [ ] Implement `context.ts` (AsyncLocalStorage), `pricing.ts`, `store.ts`.
- [ ] Run the audit tests plus `npx vitest run tests/db` — expect PASS.
- [ ] Commit: `Add audit and settings tables with the audit store`.

### Task 2: Encryption and settings store

**Files:** Create `src/lib/crypto.ts`, `src/settings/store.ts`, `src/settings/models.ts`; tests `tests/lib/crypto.test.ts`, `tests/settings/store.test.ts`. Modify `src/lib/env.ts` (optional `SETTINGS_ENCRYPTION_KEY`), `.env.example`.

**Interfaces — Produces:**
- `crypto.ts`: `encryptSecret(plain: string, aad: string): { ciphertext: string; iv: string; tag: string }` (base64 fields); `decryptSecret(p, aad): string` (throws on tamper/wrong key/wrong aad); `encryptionConfigured(): boolean`. Key: `SETTINGS_ENCRYPTION_KEY` base64, must decode to 32 bytes, else `encryptSecret` throws `HttpError(503, 'SETTINGS_ENCRYPTION_KEY is not set or invalid')`.
- `models.ts`: `PROVIDERS: Record<Provider, { label; url; envKey; defaultText; defaultVision; textModels: string[]; visionModels: string[] }>` (moved from `llm.ts` defaults, plus suggestion lists); `type Provider = 'groq'|'openai'|'anthropic'`.
- `store.ts`: `getAiConfig(): Promise<{ provider; textModel; visionModel; keySource: 'dashboard'|'env'|'none'; apiKey: string | null }>` (DB settings, else env, else defaults; key from DB (decrypt failure → treated as absent), else env); `saveSettings(s: { provider; textModel?: string|null; visionModel?: string|null }): Promise<void>`; `saveKey(provider, plain): Promise<void>` (validates shape: 8–500 chars, no whitespace); `removeKey(provider): Promise<void>`; `keyStatus(): Promise<{ provider; configured: boolean; last4: string | null; source: 'dashboard'|'env'|'none' }[]>`; `publicSettings()` combining settings + `keyStatus` + `encryptionConfigured`.

- [ ] Failing tests: crypto round-trip; flipped ciphertext byte throws; wrong AAD throws; missing/short key throws 503 and stores nothing; `saveKey` then `keyStatus` shows last4 and never the key (assert `JSON.stringify(status)` lacks the key); `getAiConfig` order: DB key beats env, env used when no DB key, `none` when neither; corrupted stored ciphertext falls back to env; `saveSettings` persists and the next `getAiConfig` reflects it.
- [ ] Run — FAIL. Implement. Run — PASS. Commit: `Add encrypted API key storage and AI settings store`.

### Task 3: AI calls use settings and record usage

**Files:** Modify `src/ai/llm.ts`, `src/ai/prompts.ts`, `src/ai/pdf.ts`; tests `tests/ai/llm.test.ts` (extend), `tests/ai/usage.test.ts`.

**Interfaces — Consumes:** `getAiConfig`, `PROVIDERS`, `recordAiCall`, `getAudit`, `estimateCostUsd`. **Produces:** `ChatOptions.purpose: 'screen'|'analyse'|'read-pages'|'test'` (required); `chat()` returns as before but each HTTP attempt writes one `ai_calls` row (status ok / rate_limited / error) with provider, model, attempt number (module-level counter per call: 1 for a fresh `chat` call), tokens, latency, previews, run and tender from `getAudit()`.

- [ ] Failing tests with stubbed fetch: OpenAI-shaped `usage.prompt_tokens/completion_tokens` stored; Anthropic `usage.input_tokens/output_tokens` stored; no `usage` stores null; 429 with `retry-after: 7` records `rate_limited` and `retryAfterS 7` then still throws `RateLimitError`; HTTP 500 records `error`; the model used is the one from `saveSettings` (not env); a DB-saved key is sent in the Authorization header; no key anywhere throws `AiError('No API key configured for groq')`; stored previews contain no key; a failing audit insert does not break `chat`.
- [ ] Run — FAIL. Refactor `chat()` to `await getAiConfig()` per call, keep Anthropic/OpenAI-compatible bodies, parse usage, record in `finally`-style per attempt. Update `prompts.ts` and `pdf.ts` call sites with their `purpose`. Run `npx vitest run tests/ai tests/jobs` — PASS (existing tests keep working; env fallback stays).
- [ ] Commit: `Resolve the AI provider from settings and audit every call`.

### Task 4: Fetch, run, settings and auth events

**Files:** Modify `src/sources/http.ts`, `src/jobs/pipeline.ts`, `src/jobs/io.ts`, `src/db/queries.ts` (run lifecycle), `src/app/api/runs/route.ts`, `src/app/api/runs/stop/route.ts`, `src/lib/auth/login.ts`, `src/app/login/actions.ts`, `src/settings/store.ts`; tests `tests/audit/events.test.ts`.

**Interfaces — Produces:** event actions: fetch `request` (details `{ url, status, bytes, attempt, kind }`, durationMs); run `queued|started|page-scanned|screened|analysed|stop-requested|force-stopped|completed|failed|cancelled` with counts in details; settings `provider-changed|model-changed|key-saved|key-removed|test` (provider and last4 only); auth `login-ok|login-failed|logout` (details `{ ip, userAgent }`). `pipeline` wraps `scanPage`/`screenIds`/`analyseTender` bodies in `withAudit({ runId, tender })`; `pruneAudit()` runs once when a run is created.

- [ ] Failing tests: `fetchBuffer` against a stubbed fetch writes a `fetch/request` event with status, bytes and attempt (and one per retry, with the failure recorded as `error`); a pipeline run with fake deps produces `run` events for page, screen and analyse with counts; `attemptLogin` failure/success write `auth` events carrying the IP but not the password; `requestStop` writes `stop-requested` then `force-stopped`; `saveKey` writes `key-saved` with last4 and the details never contain the key.
- [ ] Run — FAIL. Implement. Run full `npx vitest run` — PASS.
- [ ] Commit: `Record fetch, run, settings and login events`.

### Task 5: API routes

**Files:** Create `src/app/api/settings/route.ts`, `src/app/api/settings/keys/[provider]/route.ts`, `src/app/api/settings/test/route.ts`, `src/app/api/audit/route.ts`, `src/app/api/audit/export/route.ts`, `src/app/api/history/route.ts`, `src/app/api/history/[id]/route.ts`, `src/app/api/usage/route.ts`; modify `src/db/queries.ts` (`listRuns`, `getRunDetail`); tests `tests/api/settings.test.ts`, `tests/api/audit.test.ts`, `tests/api/history.test.ts`.

**Interfaces — Produces (JSON):**
- `GET /api/settings` → `{ provider, textModel, visionModel, providers: { id, label, defaultText, defaultVision, textModels, visionModels }[], keys: keyStatus[], encryptionConfigured }`; `PUT /api/settings` body `{ provider, textModel?, visionModel? }` (zod enum, model ids 1–100 chars, `/^[\w./:\-]+$/`).
- `PUT /api/settings/keys/[provider]` body `{ key }` → `{ ok: true, last4 }`; `DELETE` → `{ ok: true }`. 503 when encryption not configured.
- `POST /api/settings/test` → `{ ok, latencyMs, model, inputTokens, outputTokens, error? }` (real one-token call, purpose `test`, rate-limited 5/min).
- `GET /api/audit?kind=events|ai&category&status&runId&q&from&to&before&limit` → `{ rows, next }`; `GET /api/audit/export` same filters → CSV (formula-injection safe: cells starting `= + - @` are prefixed with `'`).
- `GET /api/history` → `{ runs: (run + aiCalls + inputTokens + outputTokens + estCostUsd + durationSec)[] }`; `GET /api/history/[id]` → `{ run, logs, aiCalls, events }`.
- `GET /api/usage?hours=24|168|720` → `usageSummary`.

- [ ] Failing tests per route group: each returns 401 without a session; PUT settings rejects an unknown provider and a bad model id with 400; saving a key returns only `last4` and a later GET never contains the key; a cross-origin PUT is 403; CSV cells beginning with `=` are neutralized; audit filters by category/status/run; `before` pages; history aggregates tokens per run; detail returns 404 for an unknown id.
- [ ] Run — FAIL. Implement. Run `npx vitest run tests/api` — PASS.
- [ ] Commit: `Add settings, audit, history and usage API routes`.

### Task 6: Design system, app shell and Tenders page

**Files:** Rewrite `src/app/globals.css` (tokens), `src/app/layout.tsx`; create `src/components/shell/{Shell,Sidebar,TopBar,RunStatus}.tsx`, `src/components/StatCards.tsx`, `src/components/ui/{Card,Chip,Button,EmptyState}.tsx`; modify `src/components/{Dashboard,TenderList,Runway,RunBar}.tsx` and move Tenders to `src/app/(app)/page.tsx` with `src/app/(app)/layout.tsx` hosting the shell; tests `tests/ui/shell.test.tsx`, update existing UI tests.

**Interfaces — Produces:** route group `(app)` containing `/`, `/runs`, `/audit`, `/settings`; `Shell` renders the sidebar (Tenders, Runs, Audit log, Settings), top bar with Fetch button and live run status, theme toggle, sign out; stat cards read `/api/tenders`, `/api/runs`, `/api/usage?hours=24`.

- [ ] Use the `frontend-design` skill for the visual system before writing CSS; define one token set (color, radius, shadow, spacing, type), light and dark, `prefers-reduced-motion` respected.
- [ ] Failing UI tests: sidebar shows four links with the current page marked `aria-current`; the Fetch button and Stop flow still work from the top bar; stat cards show values from mocked APIs and skeletons while loading; mobile menu toggles.
- [ ] Implement; run `npx vitest run tests/ui` and `npm run lint` and `npm run typecheck` — PASS.
- [ ] Commit: `Redesign the app shell and Tenders page`.

### Task 7: Runs page

**Files:** Create `src/app/(app)/runs/page.tsx`, `src/app/(app)/runs/[id]/page.tsx`, `src/components/runs/{RunsTable,RunDetail}.tsx`; tests `tests/ui/runs.test.tsx`.

- [ ] Failing tests: table renders status chip, duration, screened, matched, calls, input/output tokens, estimated cost ("n/a" when null); clicking a row goes to the detail; detail shows the log, AI calls (tokens per call) and fetch events as one time-ordered timeline; empty state when there are no runs.
- [ ] Implement; run UI tests; commit: `Add the Runs history and run detail pages`.

### Task 8: Audit log page

**Files:** Create `src/app/(app)/audit/page.tsx`, `src/components/audit/{AuditFilters,AuditTable}.tsx`; tests `tests/ui/audit.test.tsx`.

- [ ] Failing tests: tabs for "AI calls" and "Events"; filters change the request query; AI rows show provider, model, input and output tokens, latency, status chip; a row expands to details and the truncated prompt/reply; "Load more" uses `next`; Export CSV link carries the active filters; empty and error states.
- [ ] Implement; run UI tests; commit: `Add the Audit log page`.

### Task 9: Settings page

**Files:** Create `src/app/(app)/settings/page.tsx`, `src/components/settings/{ProviderPicker,ModelFields,KeyField,UsagePanel,TestConnection}.tsx`; tests `tests/ui/settings.test.tsx`.

- [ ] Failing tests: provider and model changes call `PUT /api/settings` and show a success toast; model dropdown offers the provider's suggestions plus a "Custom model id" input; key field never displays an existing key (shows `••••1234` and "Replace"/"Remove"); a typed key is cleared after saving; keys are disabled with an explanation when `encryptionConfigured` is false; Test connection shows latency and tokens or the error; usage panel shows 24 h / 7 d / 30 d totals and per-model rows.
- [ ] Implement; run UI tests; commit: `Add the Settings page for AI provider, model and keys`.

### Task 10: Docs, migrate, review, deploy

**Files:** Modify `README.md`, `docs/DEPLOY.md`, `.env.example`.

- [ ] Document `SETTINGS_ENCRYPTION_KEY` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), the new pages, and what is audited.
- [ ] Run the full suite, `npm run lint`, `npm run typecheck`, `npm run build`.
- [ ] Run one fresh-context review of the whole branch (Opus), fix Critical/Important findings test-first.
- [ ] Apply the migration to Neon (`DATABASE_URL` from `.env`), merge `redesign` into `main`, push, then verify the deployed app page by page in the browser (after the user adds `SETTINGS_ENCRYPTION_KEY` in Vercel).
