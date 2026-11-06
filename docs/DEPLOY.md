# Deploying to Vercel (step by step)

You need: the GitHub repo (`SajjadReactDeveloper/tender-matcher`), the Neon database (already created and migrated), and a Vercel account (free Hobby plan is fine).

## 0. Before you start

1. **Create the login password hash** (on your computer, in the project folder):
   ```bash
   npx tsx scripts/hash-password.ts 'choose-a-long-password'
   ```
   Copy the output (it looks like `scrypt:16384:ab12...:cd34...`). This is `APP_PASSWORD_HASH`. Your real password is never stored anywhere.
2. **Create a session secret** (32+ random characters):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Have ready: your Neon **pooled** connection string (`DATABASE_URL`), your AI key (`GROQ_API_KEY`, or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), and the login email you want (`APP_EMAIL`).
4. Make sure the `nextjs` branch is on GitHub (`git push -u origin nextjs`).

## 1. Import the project

1. Go to <https://vercel.com/new> and sign in (use "Continue with GitHub").
2. Under **Import Git Repository**, find `tender-matcher`. If it is not listed, click **Adjust GitHub App Permissions** and allow that repository.
3. Click **Import**.

## 2. Configure the project (before the first deploy)

On the configuration screen:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** (detected automatically) |
| Root Directory | `./` |
| Build Command / Output | leave the defaults |
| Node.js Version | **24.x** (Settings, General, Node.js Version, if it is not already) |
| Branch to deploy | Vercel deploys `main` for Production. Your new app is on `nextjs`, so the first deploy will be a **Preview** of that branch (step 5). |

**Environment Variables** (add each one, tick **Production** and **Preview**):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `SESSION_SECRET` | the 64-character value from step 0.2 |
| `APP_EMAIL` | your login email |
| `APP_PASSWORD_HASH` | the hash from step 0.1 (paste it exactly) |
| `SETTINGS_ENCRYPTION_KEY` | a random 32-byte key, so the Settings page can store API keys encrypted. Generate it with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep a copy: if you lose it, re-enter your keys on the Settings page. |
| `AI_PROVIDER` | optional fallback: `groq` (or `openai` / `anthropic`). The Settings page overrides it. |
| `GROQ_API_KEY` | optional fallback key. You can instead leave this out and paste the key on the Settings page after signing in. |

Do **not** add `DIRECT_URL` (only needed for running migrations from your own computer).

## 3. The one setting that is easy to miss

Go to **Settings, Environment Variables** and make sure **"Automatically expose System Environment Variables"** is **checked**.
Workflow recognises it is running on Vercel through `VERCEL_DEPLOYMENT_ID`; with the box cleared it falls back to a local filesystem mode and **every run fails**.

Also confirm **Settings, Functions, Fluid Compute** is on (it is the default for new projects).

## 4. (Recommended) Use a separate Neon branch for production

In the Neon dashboard, create a branch named `production` from your main branch and use *its* connection string for `DATABASE_URL` in **Production**, keeping the current one for **Preview**. Then apply the schema to it from your computer:

```bash
DIRECT_URL="<production branch non-pooled string>" node node_modules/drizzle-kit/bin.cjs migrate
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-state.ts ../old/data/state.json   # optional: only if you want the old data there too
```

## 5. First deploy (a Preview of the `nextjs` branch)

1. Click **Deploy** on the import screen. It builds `main`, which still holds the **old app**, so skip this deploy if it fails.
2. Open the project, go to **Deployments**, and push (or re-push) the `nextjs` branch: every push to a non-production branch creates a **Preview deployment**. You can also use **Settings, Git, Production Branch** and temporarily set it to `nextjs` to make it the production site.
3. Wait for the build to finish (about 1 to 2 minutes). Open the deployment URL.
   - New projects have **Vercel Authentication** on for Previews, so you may be asked to sign in to Vercel first. That is normal and is in addition to the app's own login.

## 6. Check it works (do all of these)

1. Open the URL, you should land on the **login page**. Sign in with `APP_EMAIL` and the password you hashed.
2. The dashboard should show your imported tenders (or an empty state on a fresh database).
3. Set **Scan up to** to **5** and click **Fetch latest tenders**. Watch the status line. Click **Show log**.
4. In Vercel, open **Observability, Workflows** (or the **Workflows** tab): you should see the run and its steps.
5. Read the log for a line like `could not read tenderDocument: ...`. If every tender says that, the PDF-to-image library does not run on Vercel (see "If PDFs cannot be read" below).
6. Click **Download Excel** and open the file.
7. Click **Stop run** during a run: it should say "Stopping after the current step". If a run ever looks stuck, click **Force stop**.

## 7. Go live (cutover)

When the preview works:

1. Merge the branch (this replaces the old app on `main`):
   ```bash
   git checkout main
   git merge nextjs
   git rm -r legacy          # the old app, kept only for reference
   git commit -m "Remove the old app"
   git push origin main
   ```
2. Vercel redeploys `main` as **Production**. If you changed the Production Branch earlier, set it back to `main`.
3. (Optional) **Settings, Domains** to add your own domain.

## If something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Build fails with `Failed to collect page data ... workflow` | The `serverExternalPackages` line in `next.config.ts` is missing or changed. It must list `pdf-to-img`, `pdfjs-dist` and `@napi-rs/canvas`. |
| Login always says "Invalid email or password" | `APP_PASSWORD_HASH` was pasted wrong (copy the whole line, no quotes or spaces) or `APP_EMAIL` differs. |
| Fetch says "Internal server error" | Open the Vercel deployment **Logs**. Usually `DATABASE_URL` is missing or the migration was not applied. |
| Runs fail immediately | The System Environment Variables box (step 3) is not ticked. |
| Run fails with `MAX_EVENTS_EXCEEDED` | A very large run used too many steps. Use a smaller **Scan up to** (150 to 300); leftover work is picked up by the next run. Or set `WORKFLOW_VM=quickjs` in the environment variables and redeploy. |
| "Too many failed attempts" on login | 5 wrong tries per 15 minutes per address, 20 overall. Wait 15 minutes. |
| The AI says rate limit and the run is "waiting" | Groq's free tier is limited to roughly 15 to 25 tenders of PDF reading per day. The run waits and continues by itself, or switch `AI_PROVIDER` to a paid key. |
| A run looks stuck forever | Click **Stop run** once, then **Force stop**. |

### If PDFs cannot be read on Vercel

`pdf-to-img` needs a native canvas module. If every tender logs `could not read ...`, tell me and I will switch `src/ai/pdf.ts` to send the PDF directly to a model that accepts PDFs (a small, local change).

## Security checklist after deploying

- The AI keys you used while developing (including any pasted into chat) should be rotated if you did not create them for this project.
- Keep `SESSION_SECRET` and `APP_PASSWORD_HASH` only in Vercel's environment variables, never in the repo.
- Changing `config/profile.md` needs a redeploy (it ships with the app).
