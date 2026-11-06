# Tender Matcher on Next.js: design

Date: 2026-11-06. Status: draft, waiting for approval.

## Intent

The current Tender Matcher is a plain Node script plus one HTML page, backed by a JSON file. It works for one person on one machine against one source (PPRA). Funavry will add more tender sources later and wants a shared, logged-in site that runs in production on free tiers: Vercel (Hobby) and Neon (free Postgres). The rewrite must be production quality (typed, tested, secure, observable), not a throwaway MVP, while costing nothing to host.

## Goals

- A Next.js (App Router, TypeScript) app deployed on Vercel, using Neon Postgres.
- Login with one fixed email and password. Every page and API route requires it.
- Same dashboard as today: list with fit score and verdict, closing-date chart, filters, search, detail panel, Excel export. Plus skeleton loaders, toasts and error states.
- A **Fetch** button that starts a durable background job on Vercel (Vercel Workflow). The job scans sources, screens tenders, reads PDFs, scores them, and saves progress as it goes. A **Stop** button cancels it. Runs resume cleanly after rate limits or failures.
- Adding a new tender source means adding one folder that implements a small interface and registering it in one list. No other code changes.
- Keep every security control from the audit already done on the Node app (see Security).
- Existing data (15 matched tenders and 411 screened ids in `data/state.json`) is imported, not lost.

## Non-goals

- No scheduled or automatic runs (fetching happens only on button click). The design must not prevent adding a schedule later.
- No multiple users, roles, sign-up or password reset. One fixed login.
- No actions on tenders (no bid tracking, assignment, comments). Viewing only for now.
- No paid infrastructure. Nothing here may require a paid Vercel or Neon plan.

## Anti-goals (a failure even if it technically works)

- A fetch that silently loses work or re-screens tenders it already handled when it hits a rate limit or timeout.
- A source integration that needs changes in the dashboard, the job or the database to add.
- Credentials, API keys or the login password appearing in the repo, logs, or the browser.

## Constraints

- Free tiers. Vercel Hobby has limits on function duration and cron frequency; Neon free has storage and compute limits and pauses when idle. The design uses a durable job so no single function has to run for the whole fetch.
- The AI provider is configurable by environment variable (Groq default today; OpenAI and Anthropic supported). The free Groq tier limits throughput (roughly 15 to 25 tenders of PDF reading per day), so a large fetch can take several days of daily quota unless a paid key is used.
- Source sites are scraped with `fetch`; they may change their HTML, so parsers need fixture-based tests.

## Decisions made by the owner

- Next.js app, production quality.
- Hosting: Vercel and Neon, free tiers.
- Login page with a fixed email and password.
- The job is triggered by a Fetch button, not on a schedule, and uses Vercel's job runtime (Workflow) for now. They will revisit later.
- For now the site only shows tenders.
- More sources come later; none are chosen yet.

## Design (builder's calls unless marked)

### Stack
Latest Next.js (16.4.5 on 2026-11-06, per the owner's request; use whatever `latest` is when the build starts and pin it) with the App Router, the matching latest React, the Workflow SDK (`workflow`, currently 5.4.0) and Node 24 on Vercel. Next 16 conventions apply (for example, `middleware` is now `proxy.ts`; the builder must check the Next 16 docs rather than rely on older habits). TypeScript strict, React Server Components for the page shell and client components for the interactive dashboard. Drizzle ORM with the Neon serverless driver. Vitest for tests. ESLint and Prettier. ExcelJS for export. No component library; the existing hand-written CSS is ported.

### Data model (Postgres)
- `tenders`: id, `source` (text), `external_id`, title, organization, office, location, category, sector, nature, type, ref_no, url, posting_date, closing_date, closing_time, `decision` (`matched` | `skipped`), skip_reason, plus the analysis columns (relevance, score, recommendation, challenges, scope, contact, bid_security, bid_validity, procedure, doc links, pages_read, analysed_at). Unique on (`source`, `external_id`). Screened-and-skipped tenders are rows with `decision = 'skipped'`, which replaces the old `seen` map.
- `runs`: id, status (`queued` | `running` | `completed` | `failed` | `cancelled`), started_at, finished_at, error, `stop_requested`, workflow_run_id, counters.
- `run_logs`: run_id, at, message. Shown in the UI log panel.
- `login_attempts`: for rate limiting the login form (in-memory limits do not work across serverless instances).

### Sources
Each source is a folder under `src/sources/<name>/` exporting `{ id, name, listPage(page) -> { total, tenders[] }, getDetail(externalId) }` returning one shared normalized shape. A registry file lists enabled sources. PPRA is the first, ported from `src/ppra.js`.

### The job (Vercel Workflow)
`POST /api/runs` (authenticated, origin-checked) creates a `runs` row, rejects with 409 if one is active, and starts the workflow. The workflow function only orchestrates; every unit of work is a step with its own retry:
1. Per source: scan listing pages until the requested number of unseen tenders is found. Persist as it goes.
2. Screen in batches of 20 (one step per batch). Write verdicts to the database immediately.
3. For each likely match: one step downloads PDFs, renders pages, calls the vision model and the text model, and saves the result.
Rate limits throw a retryable error with the provider's wait time, so the workflow sleeps durably instead of holding a function open. Each step checks `stop_requested` first. Because everything is written to the database as it happens, a failed or cancelled run loses nothing and the next run continues.

### Dashboard
Server-rendered shell, client component for the list. Data comes from `GET /api/tenders`. Status and logs come from `GET /api/runs/current` and are polled while a run is active. Loading skeletons, error states with retry, and success/error toasts are included. A source filter is built in but hidden until there is more than one source.

### Security (carried over from the audit)
- Fixed credentials from environment variables: `APP_EMAIL` and `APP_PASSWORD_HASH` (a hash, not the plain password). Constant-time comparison.
- Session: signed, HttpOnly, Secure, SameSite=Strict cookie (JWT signed with `SESSION_SECRET`), checked in middleware for every page and API route except `/login`.
- Login rate limiting through `login_attempts` (block after repeated failures).
- Origin check on every state-changing route (CSRF); JSON content type required; request body size limits.
- Security headers and a nonce-based CSP via middleware: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `Cache-Control: no-store` for API responses.
- No CORS headers; cross-origin API calls rejected.
- Errors returned to the browser are generic; details are logged server-side with secrets redacted.
- PDF downloads capped at 40 MB. Dependency audit runs in CI.

### Excel export
Route handler `GET /api/export.xlsx` with the same eleven columns as today, authenticated and rate limited.

### Company profile
Stays as `config/profile.md` in the repo and is read at the start of each run (bundled with the deployment). Editing it means a redeploy. (My call: simplest; moving it into the database with an edit page is a later change.) The profile content itself is also revised so hardware supply no longer counts as a match, per the owner's earlier feedback; the owner should confirm the final wording.

### Data migration
A one-off script imports `data/state.json` into Neon: the 15 matched tenders and the 411 screened ids (as `skipped` rows where no detail exists), all with `source = 'ppra'`.

### Testing and delivery
- Unit tests for the PPRA listing and detail parsers using saved HTML fixtures, the screening/scoring JSON parsing, auth (hash check, cookie signing, origin check), and rate limiting.
- A workflow integration test using the Workflow Vitest plugin with a fake source and fake AI client.
- GitHub Actions on every push: typecheck, lint, test, `npm audit`.
- Deploy through the Vercel GitHub integration; Neon migrations run from CI or a manual `drizzle-kit migrate` step.
- Local development uses a Neon dev branch and a `.env.example` listing every variable.

### Repo layout and cutover
Work happens on a branch (`nextjs`) in the existing repo. The old Node app stays untouched and working on `main` until the new app is deployed and verified, then it is removed in the merge. (My call.)

## Open risks (for the builder to resolve or report)
- `pdf-to-img` (pdf.js plus a native canvas module) may not run on Vercel's serverless runtime. If it does not, fall back to sending the PDF directly to a vision model that accepts PDFs, or to a pure-JS renderer. Confirm with a deployed spike before relying on it.
- Vercel Hobby limits on step duration and Workflow usage need to be confirmed against current Vercel documentation; the step granularity above (one tender per step) is chosen to stay well inside any plausible limit.
- Neon free-tier cold starts add a second or two to the first request after idle time.
- PPRA is currently the only source, and its HTML may change without notice.

## Left to the builder
Folder naming, exact table and column names, Drizzle migration workflow, CSS organisation, the exact rate-limit thresholds for login, test file layout, and logging format.
