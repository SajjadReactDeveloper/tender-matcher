import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse } from '@/ai/prompts';
import { screenBatch } from '@/ai/prompts';
import { readDocuments } from '@/ai/pdf';
import { appendLog, bumpCounters, isStopRequested } from '@/db/queries';
import { getPendingRows, getTenderRow, insertPending, insertSkipped, knownTenders, markCandidate, markSkipped, rowToListed, saveMatched, updateClosing } from '@/db/tenders';
import type { Analysis } from '@/domain/types';
import { sources } from '@/sources';
import type { ListedTender, TenderDetail, TenderSource } from '@/sources/types';

// Everything the pipeline needs from the outside world, so tests can swap the sources and the AI for fakes.
export interface PipelineDeps {
  sources: TenderSource[];
  screenBatch: (batch: ListedTender[], profile: string) => Promise<Map<string, { relevant: boolean; reason: string }>>;
  analyse: (t: ListedTender, d: TenderDetail, docText: string, profile: string) => Promise<Analysis>;
  readDocuments: (links: TenderDetail['links'], fileUrl: (path: string) => string, maxPages: number, log?: (m: string) => void) => Promise<{ text: string; pages: number }>;
  profile: () => string;
  maxDocPages: number;
}

export const defaultDeps = (): PipelineDeps => ({
  sources,
  screenBatch,
  analyse,
  readDocuments,
  profile: () => readFileSync(join(process.cwd(), 'config', 'profile.md'), 'utf8'),
  // Tender-document pages read per tender (plus 1 advertisement page): each page costs ~2k vision tokens.
  maxDocPages: Number(process.env.MAX_DOC_PAGES) || 4,
});

const sourceOf = (deps: PipelineDeps, id: string): TenderSource => {
  const s = deps.sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}"`);
  return s;
};

// Reads listing pages newest first and saves unseen tenders as pending until `limit` are found or the pages run out.
export async function scanSource(runId: number, sourceId: string, limit: number, deps: PipelineDeps): Promise<number> {
  const source = sourceOf(deps, sourceId);
  const known = await knownTenders(source.id);
  let added = 0;
  let pages = Infinity;
  await appendLog(runId, `Scanning ${source.name} for new tenders (up to ${limit})...`);
  for (let page = 1; page <= pages && added < limit; page++) {
    if (page > 1 && (await isStopRequested(runId))) break;
    const { total, tenders } = await source.listPage(page);
    if (page === 1) pages = Math.max(1, Math.ceil(total / tenders.length));
    const fresh: ListedTender[] = [];
    for (const t of tenders) {
      const seen = known.get(t.externalId);
      if (seen) {
        if ((t.closing || null) !== seen.closingDate || (t.closingTime || null) !== seen.closingTime) await updateClosing(source.id, t); // corrigendum moved the date
      } else if (/cancel/i.test(t.status)) {
        await insertSkipped(source.id, t, 'cancelled');
        known.set(t.externalId, { closingDate: null, closingTime: null });
      } else if (added + fresh.length < limit) {
        fresh.push(t);
        known.set(t.externalId, { closingDate: t.closing || null, closingTime: t.closingTime || null });
      }
    }
    added += await insertPending(source.id, fresh);
    await appendLog(runId, `  page ${page}: ${tenders.length} listed, ${added} new so far (${total} active in total)`);
  }
  return added;
}

// Quick yes/no on the listing fields. Returns how many looked relevant. Tenders without a verdict stay pending for the next run.
export async function screenIds(runId: number, ids: number[], deps: PipelineDeps): Promise<number> {
  const rows = await getPendingRows(ids);
  if (!rows.length) return 0;
  const verdicts = await deps.screenBatch(rows.map(rowToListed), deps.profile());
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
  return relevant;
}

// Reads the documents and scores one candidate. A rate limit or AI error propagates and leaves the row a candidate.
export async function analyseTender(runId: number, id: number, deps: PipelineDeps): Promise<void> {
  const row = await getTenderRow(id);
  if (!row || row.decision !== 'candidate') return;
  const source = sourceOf(deps, row.source);
  const listed = rowToListed(row);
  await appendLog(runId, `Reading ${row.externalId} ${row.title}`);
  const detail = await source.getDetail(row.externalId);
  const docs = await deps.readDocuments(detail.links, source.fileUrl, deps.maxDocPages, (m) => void appendLog(runId, `  ${m}`).catch(() => {}));
  const analysis = await deps.analyse(listed, detail, docs.text, deps.profile());
  await saveMatched(id, detail, analysis, docs.pages);
  await bumpCounters(runId, { matched: 1 });
  await appendLog(runId, `  -> ${analysis.relevance}, score ${analysis.score}`);
}
