# PPRA Tender Matcher

Pulls the latest active tenders from epms.ppra.gov.pk, screens them against the Funavry profile with AI, reads the
scanned tender PDFs for the likely matches, and stores scored results in a dashboard and an Excel file.

## Run
Double-click `start.bat` (or `npm start`). The dashboard opens at http://localhost:3010. Click **Fetch latest tenders**.
Needs Node 20.6+ (uses `--env-file`).

## Where things are
- `output/tenders.xlsx` is rewritten after every run (close it in Excel first). The dashboard also has **Download Excel**.
  Columns match the team's Google Sheet; paste or import it there.
- `data/state.json` is the database: matched tenders plus every tender already screened (never reprocessed).
- `config/profile.md` is the company profile the AI matches against. Edit it freely.
- `.env` holds the provider and API key.

## How a run works
1. Reads PPRA listing pages (newest first) until it has "Scan up to N new" unseen tenders, or reaches ones it already knows.
2. Quick AI screen of title/description/sector in batches of 20; obvious misses are remembered and skipped.
3. For likely matches: downloads the Advertisement and Tender Document PDFs, the vision model reads 1 + 4 pages by default (MAX_DOC_PAGES), then
   a text model produces relevance, score, recommendation, challenges and a ~200-word scope.
4. Closing-date changes from corrigenda are applied to known tenders on every run.

Scores and summaries are AI estimates. Tender documents are often only the cover letter, so check the PDFs before bidding.

## Switching AI provider
In `.env` set `AI_PROVIDER=openai` (or `anthropic`) and fill the matching key. Default models live in `src/llm.js`;
override with `TEXT_MODEL` / `VISION_MODEL`. The Groq free tier limits reading PDFs: its vision model allows 200k tokens a day
(roughly 15-25 tenders) and about 1000 output tokens a minute. When the daily quota runs out the run stops with a "try again in N min"
message and resumes where it left off. OpenAI or Anthropic have much higher limits.
