# Tender Matcher: redesign, audit log and in-app AI settings

Date: 2026-11-07. Builds on `2026-11-06-nextjs-tender-matcher-design.md`. Branch: `redesign`.

## Why

The app works and is deployed, but three things are missing:

1. It looks like a prototype: one long page, no navigation, little hierarchy.
2. When something goes wrong (a tender scored on listing text alone, a 3-minute stall, a Groq limit) there is no record of what the app did or what the AI cost. Today only a short run log exists.
3. Changing the AI provider, model or key means editing Vercel env vars and redeploying.

## Goals

- A redesigned app with real navigation and four pages: **Tenders**, **Runs**, **Audit log**, **Settings**.
- An audit trail detailed enough to answer "what exactly happened, and what did it cost" for every fetch and every AI call.
- AI provider, model and API keys managed from the dashboard, effective on the next call without a redeploy.

## Non-goals

- Multiple users, roles or per-user audit identities. One fixed owner stays.
- Editing the company profile (`config/profile.md`) in the UI.
- Prompt-level editing, new tender sources, scheduling. (Sources and schedule stay as designed earlier.)
- Real-money billing figures. Cost is an *estimate* from a small built-in price table, shown as "n/a" for models not in it.

## Decisions (user's)

- API keys are stored **encrypted in Neon** (AES-256-GCM), key from one new env var `SETTINGS_ENCRYPTION_KEY`.
- Look: **clean modern SaaS**: left sidebar, roomy cards, light and dark themes, polished stat header.

## Decisions (mine, to be checked)

- Env vars keep working as a **fallback**: if no key is saved in the dashboard for the chosen provider, `GROQ_API_KEY` etc. are used. A deployment that works today keeps working after this ships.
- Settings are read **per AI call** (one small query), so a change applies to the very next call, even mid-run.
- Audit rows are **append-only**: no API deletes or edits them. Rows older than 180 days are pruned when a run starts.
- Prompts and replies are stored **truncated to 4,000 characters** and passed through `redact()`. Page images are never stored, only their count.

## 1. Settings (AI provider, model, keys)

Table `settings` (single row, id = 1): `provider` (groq | openai | anthropic), `text_model`, `vision_model` (nullable = provider default), `updated_at`.

Table `api_keys`: `provider` (primary key), `ciphertext`, `iv`, `tag`, `last4`, `updated_at`. Encryption: AES-256-GCM, random 12-byte IV per save, provider name as AAD, key = base64 32 bytes from `SETTINGS_ENCRYPTION_KEY`. The browser only ever receives `{ provider, configured, last4, source: 'dashboard' | 'env' | 'none' }`.

Resolution order for a call: DB provider/model, else env (`AI_PROVIDER`, `TEXT_MODEL`, `VISION_MODEL`), else built-in defaults. Key: DB key for that provider, else env var, else a clear error.

Settings page: provider selector; text and vision model dropdowns per provider with a "custom model id" option; one key field per provider (write-only, shows `••••1234`, "Replace" and "Remove"); a **Test connection** button that makes one tiny real call and reports latency, status and tokens; a usage summary (section 3). If `SETTINGS_ENCRYPTION_KEY` is missing, key fields are disabled with an explanation, and provider/model changes still work.

API: `GET /api/settings`, `PUT /api/settings` (provider/models), `PUT /api/settings/keys/[provider]`, `DELETE /api/settings/keys/[provider]`, `POST /api/settings/test`. All behind `requireSession`, same-origin, JSON-only, small bodies, rate-limited. A key is validated for shape only (non-empty, no whitespace, under 500 chars), never echoed, never logged; errors go through `redact()`.

## 2. Audit log

Table `ai_calls` (one row per provider HTTP attempt, including retries and 429s): `at`, `run_id`, `tender_external_id`, `purpose` (screen | analyse | read-pages | test), `provider`, `model`, `attempt`, `status` (ok | rate_limited | error), `http_status`, `input_tokens`, `output_tokens`, `total_tokens`, `images`, `prompt_chars`, `reply_chars`, `latency_ms`, `retry_after_s`, `est_cost_usd`, `error`, `prompt_preview`, `reply_preview`.

Table `audit_events` (everything else): `at`, `category` (fetch | run | settings | auth), `action`, `status`, `run_id`, `ref`, `duration_ms`, `details` (jsonb, redacted). Events recorded:

- **fetch**: each HTTP request to a tender source (listing page, detail page, PDF download): url, status, bytes, duration, attempt, error.
- **run**: queued, started, page scanned (listed/new counts), screened batch, tender analysed (relevance, score, pages read), stop requested, force stop, completed, failed, cancelled. Each with counts.
- **settings**: provider or model changed (old and new), key added/replaced/removed (provider and last4 only), test connection.
- **auth**: login success and failure (IP, user agent), logout.

Audit page: a filterable table (category, status, run, date range, search), newest first, cursor-paginated 50 at a time, rows expand to show the details and the truncated prompt/reply. **Export CSV** of the current filter. AI calls show input/output tokens as columns.

## 3. Runs and usage

- **Runs page**: history table (id, status, started, duration, screened, matched, AI calls, input/output tokens, est. cost). A run opens a detail view with its log, its AI calls and its fetch events as one timeline.
- **Usage summary** (Settings and Tenders header): for 24 h / 7 d / 30 d: calls, input tokens, output tokens, rate-limit hits, errors, estimated cost, broken down by model.
- Token counts come from the provider's `usage` object. If a provider omits it, the columns are null and shown as "n/a", never guessed.

## 4. Redesign

App shell: collapsible left sidebar (Tenders, Runs, Audit log, Settings), top bar with the Fetch button and run status, theme toggle, sign out. Mobile: sidebar becomes a bottom/overlay menu.

- **Tenders**: stat cards (matched, open now, closing in 7 days, average fit, last run, tokens today), the closing runway chart restyled, a cleaner list with relevance chips, filters in one row, an expanded-row detail panel, skeletons and designed empty states.
- Visual system: one token set (color, radius, shadow, spacing, type scale) in `globals.css`, system fonts plus one display face, accent gradient, motion limited to small transitions and respecting `prefers-reduced-motion`. Light and dark both first-class. Accessible contrast, visible focus, keyboard navigation.
- No new heavy dependencies: charts are small inline SVG/CSS.

## 5. Security and operations

- Every new route and page needs a session. CSP unchanged (nonce, no inline scripts).
- Keys exist in plaintext only in server memory for the duration of a call. They are excluded from audit details and logs by `redact()` plus never being passed into them.
- Migrations are additive (new tables only) and applied to Neon before the deploy, so the old code keeps working during the switch.
- Audit writes must never break a run: a failed audit insert is swallowed and reported to `console.error` only.

## 6. Testing

- TDD with PGlite and the real migrations: crypto round-trip and tamper detection, settings resolution order, key never returned by the API, every route rejects without a session, audit rows written for fetch/AI/settings/auth, token extraction for all three providers, rate-limit rows, pruning.
- UI tests for the shell, settings form, audit filters.
- After deploy: a real run on Vercel and a click-through of every page.

## Left to the builder

Exact visual styling, the price table values, page copy, pagination page size details.
