import { AiError } from '@/ai/llm';
import { withAudit } from '@/audit/context';
import { recordEvent } from '@/audit/store';
import { analyse, screenBatch } from '@/ai/prompts';
import { readDocuments } from '@/ai/pdf';
import { appendLog, bumpCounters } from '@/db/queries';
import { getPendingRows, getTenderRow, insertPending, insertSkipped, knownTenders, markCandidate, markSkipped, rowToListed, saveMatched, updateClosing } from '@/db/tenders';
import type { Analysis } from '@/domain/types';
import { redact } from '@/lib/security';
import { getProfile } from '@/settings/profile';
import { sources } from '@/sources';
import { SourceShapeError, type ListedTender, type TenderDetail, type TenderSource } from '@/sources/types';
import { isFatalAiError } from './errors';
import type { ScanPageResult } from './orchestrate';

// Everything the pipeline needs from the outside world, so tests can swap the sources and the AI for fakes.
export interface PipelineDeps {
  sources: TenderSource[];
  screenBatch: (batch: ListedTender[], profile: string) => Promise<Map<string, { relevant: boolean; reason: string }>>;
  analyse: (t: ListedTender, d: TenderDetail, docText: string, profile: string) => Promise<Analysis>;
  readDocuments: (links: TenderDetail['links'], fileUrl: (path: string) => string, maxPages: number, log?: (m: string) => void) => Promise<{ text: string; pages: number }>;
  profile: () => string | Promise<string>;
  maxDocPages: number;
}

export const defaultDeps = (): PipelineDeps => ({
  sources,
  screenBatch,
  analyse,
  readDocuments,
  profile: async () => (await getProfile()).text, // the saved profile, else config/profile.md
  // Tender-document pages read per tender (plus 1 advertisement page): each page costs ~2k vision tokens.
  maxDocPages: Number(process.env.MAX_DOC_PAGES) || 4,
});

const sourceOf = (deps: PipelineDeps, id: string): TenderSource => {
  const s = deps.sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}"`);
  return s;
};

// Reads ONE listing page: saves up to `remaining` unseen tenders as pending, applies corrigendum date changes to known ones.
// One page per workflow step keeps each step short and lets Stop take effect between pages.
export const scanPage = (runId: number, sourceId: string, page: number, remaining: number, deps: PipelineDeps): Promise<ScanPageResult> =>
  withAudit({ runId }, () => scanPageInner(runId, sourceId, page, remaining, deps));

async function scanPageInner(runId: number, sourceId: string, page: number, remaining: number, deps: PipelineDeps): Promise<ScanPageResult> {
  const source = sourceOf(deps, sourceId);
  if (page === 1) await appendLog(runId, `Scanning ${source.name} for new tenders...`);
  const { total, tenders } = await source.listPage(page);
  if (!tenders.length) {
    if (page === 1) throw new SourceShapeError('source returned no tenders');
    return { added: 0, pages: null, done: true }; // the listing shrank while we were reading it
  }
  const known = await knownTenders(source.id, tenders.map((t) => t.externalId));
  const fresh: ListedTender[] = [];
  for (const t of tenders) {
    const seen = known.get(t.externalId);
    if (seen) {
      if ((t.closing || null) !== seen.closingDate || (t.closingTime || null) !== seen.closingTime) await updateClosing(source.id, t); // corrigendum moved the date
    } else if (/cancel/i.test(t.status)) {
      await insertSkipped(source.id, t, 'cancelled');
    } else if (fresh.length < remaining) {
      fresh.push(t);
    }
  }
  const added = await insertPending(source.id, fresh);
  await appendLog(runId, `  page ${page}: ${tenders.length} listed, ${added} new (${total} active in total)`);
  await recordEvent({ category: 'run', action: 'page-scanned', status: 'ok', runId, ref: source.id, details: { source: source.id, page, listed: tenders.length, added, total } });
  return { added, pages: page === 1 ? Math.max(1, Math.ceil(total / tenders.length)) : null, done: false };
}

// Quick yes/no on the listing fields. Returns how many looked relevant. Tenders without a verdict stay pending for the next run.
export const screenIds = (runId: number, ids: number[], deps: PipelineDeps): Promise<number> => withAudit({ runId }, () => screenIdsInner(runId, ids, deps));

async function screenIdsInner(runId: number, ids: number[], deps: PipelineDeps): Promise<number> {
  const rows = await getPendingRows(ids);
  if (!rows.length) return 0;
  const verdicts = await deps.screenBatch(rows.map(rowToListed), await deps.profile());
  let relevant = 0;
  let judged = 0;
  for (const row of rows) {
    const v = verdicts.get(row.externalId);
    if (!v) continue;
    judged++;
    if (v.relevant) {
      relevant++;
      await markCandidate(row.id);
    } else {
      await markSkipped(row.id, v.reason);
    }
  }
  await bumpCounters(runId, { screened: judged });
  await appendLog(runId, `  screened ${judged} of ${rows.length}, ${relevant} look relevant`);
  await recordEvent({ category: 'run', action: 'screened', status: 'ok', runId, details: { requested: rows.length, judged, relevant } });
  return relevant;
}

// Reads the documents and scores one candidate. A rate limit, a transient AI error or a rejected key propagates and leaves
// the row a candidate. An AI error that can never succeed for THIS tender (for example the request is too large) closes it as
// skipped, so it does not burn the quota again on every run.
export async function analyseTender(runId: number, id: number, deps: PipelineDeps): Promise<void> {
  const row = await getTenderRow(id);
  if (!row || row.decision !== 'candidate') return;
  return withAudit({ runId, tender: row.externalId }, () => analyseRow(runId, id, row, deps));
}

async function analyseRow(runId: number, id: number, row: NonNullable<Awaited<ReturnType<typeof getTenderRow>>>, deps: PipelineDeps): Promise<void> {
  const source = sourceOf(deps, row.source);
  const listed = rowToListed(row);
  await appendLog(runId, `Reading ${row.externalId} ${row.title}`);
  try {
    const detail = await source.getDetail(row.externalId);
    const docs = await deps.readDocuments(detail.links, source.fileUrl, deps.maxDocPages, (m) => void appendLog(runId, `  ${m}`).catch(() => {}));
    const analysis = await deps.analyse(listed, detail, docs.text, await deps.profile());
    await saveMatched(id, detail, analysis, docs.pages);
    await bumpCounters(runId, { matched: 1 });
    await appendLog(runId, `  -> ${analysis.relevance}, score ${analysis.score}`);
    await recordEvent({ category: 'run', action: 'analysed', status: 'ok', runId, ref: row.externalId, details: { relevance: analysis.relevance, score: analysis.score, pages: docs.pages } });
  } catch (e) {
    if (e instanceof AiError && !e.retryable && !isFatalAiError(e)) {
      await markSkipped(id, redact(`analysis failed: ${e.message}`).slice(0, 300)); // AiError already redacts; kept here so the stored text never depends on that
      await appendLog(runId, `  skipped: analysis failed (${e.message})`);
      await recordEvent({ category: 'run', action: 'analysis-skipped', status: 'error', runId, ref: row.externalId, details: { error: e.message } });
      return;
    }
    throw e;
  }
}
