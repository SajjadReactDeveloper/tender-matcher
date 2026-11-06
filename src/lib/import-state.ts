import { getTableColumns, sql } from 'drizzle-orm';
import { getDb, withRetry } from '@/db/client';
import { tenders } from '@/db/schema';

// The shape of the old app's data/state.json.
export interface LegacyTender {
  id: string;
  refNo?: string;
  url?: string;
  postingDate?: string;
  lastDate?: string;
  closingTime?: string;
  department?: string;
  office?: string;
  location?: string;
  name: string;
  category?: string;
  sector?: string;
  nature?: string;
  type?: string;
  relevance?: 'High' | 'Medium' | 'Low';
  score?: number;
  recommendation?: string;
  challenges?: string;
  scope?: string;
  contact?: string;
  bidSecurity?: string;
  bidValidity?: string;
  procedure?: string;
  docs?: { tender?: string; advertisement?: string; pagesRead?: number };
  analysedAt?: string;
}
export interface LegacyState {
  seen: Record<string, { decision: 'skip' | 'match'; reason?: string; title?: string; at?: string }>;
  tenders: Record<string, LegacyTender>;
}

const orNull = (s: string | undefined) => (s ? s : null);

// Idempotent. A legacy matched tender upgrades a row that is only pending, candidate or skipped (it carries the analysis);
// a row already matched is never overwritten, so re-running, or running after real fetches, is safe.
export async function importState(state: LegacyState, source = 'ppra'): Promise<{ matched: number; skipped: number }> {
  const legacyTenders = Object.values(state.tenders ?? {});
  const matchedIds = new Set(legacyTenders.map((t) => t.id));
  const matchedRows = legacyTenders.map((t) => ({
    source, externalId: t.id, decision: 'matched' as const, title: t.name, refNo: orNull(t.refNo), url: orNull(t.url), postingDate: orNull(t.postingDate), closingDate: orNull(t.lastDate),
    closingTime: orNull(t.closingTime), organization: orNull(t.department), office: orNull(t.office), location: orNull(t.location), category: orNull(t.category), sector: orNull(t.sector),
    nature: orNull(t.nature), type: orNull(t.type), relevance: t.relevance ?? null, score: t.score ?? null, recommendation: orNull(t.recommendation), challenges: orNull(t.challenges),
    scope: orNull(t.scope), contact: orNull(t.contact), bidSecurity: orNull(t.bidSecurity), bidValidity: orNull(t.bidValidity), procedure: orNull(t.procedure),
    docTender: orNull(t.docs?.tender), docAdvertisement: orNull(t.docs?.advertisement), pagesRead: t.docs?.pagesRead ?? null, analysedAt: t.analysedAt ? new Date(t.analysedAt) : null,
  }));
  const skippedRows = Object.entries(state.seen ?? {})
    .filter(([id]) => !matchedIds.has(id))
    .map(([id, s]) => ({ source, externalId: id, decision: 'skipped' as const, title: s.title || id, skipReason: orNull(s.reason) }));

  const cols = getTableColumns(tenders);
  const keep = new Set(['source', 'externalId']);
  const upgrade = Object.fromEntries(
    Object.keys(matchedRows[0] ?? {}).filter((k) => !keep.has(k)).map((k) => [k, sql.raw(`excluded."${cols[k as keyof typeof cols].name}"`)]),
  );

  const insert = async (rows: (typeof matchedRows)[number][] | typeof skippedRows, matched: boolean): Promise<number> => {
    let n = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const q = getDb().insert(tenders).values(chunk as never);
      const done = matched
        ? q.onConflictDoUpdate({ target: [tenders.source, tenders.externalId], set: upgrade, setWhere: sql`${tenders.decision} <> 'matched'` })
        : q.onConflictDoNothing();
      n += (await withRetry(() => done.returning({ id: tenders.id }))).length;
    }
    return n;
  };
  return { matched: await insert(matchedRows, true), skipped: await insert(skippedRows, false) };
}
