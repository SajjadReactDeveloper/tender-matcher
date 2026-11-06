import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Analysis } from '@/domain/types';
import type { ListedTender, TenderDetail } from '@/sources/types';
import { getDb, withRetry } from './client';
import { tenders } from './schema';

export type TenderRow = typeof tenders.$inferSelect;

const orNull = (s: string) => (s ? s : null);

export const rowToListed = (r: TenderRow): ListedTender => ({
  externalId: r.externalId, title: r.title, note: r.note ?? '', description: r.description ?? '', sector: r.sector ?? '', refNo: r.refNo ?? '',
  status: '', corrigendum: false, advertised: r.postingDate ?? '', closing: r.closingDate ?? '', closingTime: r.closingTime ?? '',
  organization: r.organization ?? '', office: r.office ?? '', location: r.location ?? '', type: r.type ?? '', category: r.category ?? '', nature: r.nature ?? '', url: r.url ?? '',
});

const toValues = (source: string, t: ListedTender) => ({
  source, externalId: t.externalId, title: t.title, note: orNull(t.note), description: orNull(t.description), organization: orNull(t.organization), office: orNull(t.office),
  location: orNull(t.location), category: orNull(t.category), sector: orNull(t.sector), nature: orNull(t.nature), type: orNull(t.type), refNo: orNull(t.refNo), url: orNull(t.url),
  postingDate: orNull(t.advertised), closingDate: orNull(t.closing), closingTime: orNull(t.closingTime),
});

export async function knownTenders(source: string, externalIds: string[]): Promise<Map<string, { closingDate: string | null; closingTime: string | null }>> {
  if (!externalIds.length) return new Map();
  const rows = await withRetry(() =>
    getDb().select({ id: tenders.externalId, d: tenders.closingDate, t: tenders.closingTime }).from(tenders).where(and(eq(tenders.source, source), inArray(tenders.externalId, externalIds))),
  );
  return new Map(rows.map((r) => [r.id, { closingDate: r.d, closingTime: r.t }]));
}

// Unseen tenders enter as pending. Returns how many rows were really inserted (conflicts are ignored).
export async function insertPending(source: string, list: ListedTender[]): Promise<number> {
  if (!list.length) return 0;
  const rows = await withRetry(() => getDb().insert(tenders).values(list.map((t) => ({ ...toValues(source, t), decision: 'pending' as const }))).onConflictDoNothing().returning({ id: tenders.id }));
  return rows.length;
}

export async function insertSkipped(source: string, t: ListedTender, reason: string): Promise<void> {
  await withRetry(() => getDb().insert(tenders).values({ ...toValues(source, t), decision: 'skipped', skipReason: reason }).onConflictDoNothing());
}

// A corrigendum can move the closing date of a tender we already hold.
export async function updateClosing(source: string, t: ListedTender): Promise<void> {
  await withRetry(() =>
    getDb().update(tenders).set({ closingDate: orNull(t.closing), closingTime: orNull(t.closingTime) }).where(and(eq(tenders.source, source), eq(tenders.externalId, t.externalId))),
  );
}

export async function pendingIds(limit: number): Promise<number[]> {
  const rows = await withRetry(() => getDb().select({ id: tenders.id }).from(tenders).where(eq(tenders.decision, 'pending')).orderBy(asc(tenders.id)).limit(limit));
  return rows.map((r) => r.id);
}

export async function candidateIds(): Promise<number[]> {
  const rows = await withRetry(() => getDb().select({ id: tenders.id }).from(tenders).where(eq(tenders.decision, 'candidate')).orderBy(asc(tenders.id)));
  return rows.map((r) => r.id);
}

export async function getPendingRows(ids: number[]): Promise<TenderRow[]> {
  if (!ids.length) return [];
  return withRetry(() => getDb().select().from(tenders).where(and(inArray(tenders.id, ids), eq(tenders.decision, 'pending'))));
}

export async function getTenderRow(id: number): Promise<TenderRow | undefined> {
  const [row] = await withRetry(() => getDb().select().from(tenders).where(eq(tenders.id, id)));
  return row;
}

export async function markSkipped(id: number, reason: string): Promise<void> {
  await withRetry(() => getDb().update(tenders).set({ decision: 'skipped', skipReason: reason }).where(eq(tenders.id, id)));
}

export async function markCandidate(id: number): Promise<void> {
  await withRetry(() => getDb().update(tenders).set({ decision: 'candidate' }).where(eq(tenders.id, id)));
}

// One update writes the whole result, so a tender is never left half analysed.
export async function saveMatched(id: number, d: TenderDetail, a: Analysis, pagesRead: number): Promise<void> {
  await withRetry(() =>
    getDb()
      .update(tenders)
      .set({
        decision: 'matched', relevance: a.relevance, score: a.score, recommendation: a.recommendation, challenges: a.challenges, scope: a.scope,
        contact: [d.contactPerson, d.contactEmail, d.contactPhone].filter(Boolean).join(' | ') || null,
        bidSecurity: orNull(d.bidSecurity), bidValidity: orNull(d.bidValidity), procedure: orNull(d.procedure),
        docAdvertisement: d.links.advertisement ?? null, docTender: d.links.tenderDocument ?? null, pagesRead, analysedAt: new Date(),
      })
      .where(eq(tenders.id, id)),
  );
}

// Matched tenders only, newest posting date first (undated last).
export async function listMatched(source?: string): Promise<TenderRow[]> {
  return withRetry(() =>
    getDb()
      .select()
      .from(tenders)
      .where(source ? and(eq(tenders.decision, 'matched'), eq(tenders.source, source)) : eq(tenders.decision, 'matched'))
      .orderBy(sql`${tenders.postingDate} desc nulls last`, desc(tenders.id)),
  );
}
