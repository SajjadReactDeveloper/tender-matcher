import { beforeEach, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { tenders } from '@/db/schema';
import { createRun } from '@/db/queries';
import type { Db } from '@/db/client';
import { analyseTender, screenIds } from '@/jobs/pipeline';
import { RateLimitError } from '@/ai/llm';
import { SourceShapeError } from '@/sources/types';
import { createTestDb } from '../helpers/test-db';
import { fakeDeps, fakeSource, scanAll } from '../helpers/fakes';

let db: Db;
let runId: number;
beforeEach(async () => {
  db = await createTestDb();
  runId = (await createRun(100)).id;
});

const rows = (decision: string) => db.select().from(tenders).where(eq(tenders.decision, decision as 'pending'));

describe('scanSource', () => {
  test('stores up to `limit` unseen tenders as pending, across pages, and stops without reading past the last page', async () => {
    const src = fakeSource(120, { pageSize: 50 });
    expect(await scanAll(runId, 'fake', 100, fakeDeps(src, []))).toBe(100);
    expect(await rows('pending')).toHaveLength(100);
    expect(src.calls).toEqual([1, 2]);

    const all = fakeSource(30, { pageSize: 50 });
    await createTestDb();
    const r2 = (await createRun(100)).id;
    expect(await scanAll(r2, 'fake', 100, fakeDeps(all, []))).toBe(30);
    expect(all.calls).toEqual([1]);
  });

  test('skips tenders it already knows and updates a known tender\'s closing date (corrigendum)', async () => {
    const src = fakeSource(5);
    await scanAll(runId, 'fake', 100, fakeDeps(src, ['T001']));
    await screenIds(runId, [1, 2, 3, 4, 5], fakeDeps(src, ['T001']));
    const changed = fakeSource(7, { over: { T001: { closing: '2026-12-15', closingTime: '14:00' } } });
    expect(await scanAll(runId, 'fake', 100, fakeDeps(changed, []))).toBe(2); // only T006 and T007 are new
    const [t1] = await db.select().from(tenders).where(eq(tenders.externalId, 'T001'));
    expect(t1.closingDate).toBe('2026-12-15');
    expect(t1.closingTime).toBe('14:00');
  });

  test('records cancelled tenders as skipped instead of queueing them', async () => {
    const src = fakeSource(3, { over: { T002: { status: 'Cancelled' } } });
    expect(await scanAll(runId, 'fake', 100, fakeDeps(src, []))).toBe(2);
    expect(await rows('skipped')).toMatchObject([{ externalId: 'T002', skipReason: 'cancelled' }]);
  });

  test('lets a SourceShapeError from the source propagate', async () => {
    const src = fakeSource(3);
    src.listPage = async () => { throw new SourceShapeError('source returned no tenders'); };
    await expect(scanAll(runId, 'fake', 10, fakeDeps(src, []))).rejects.toThrow('source returned no tenders');
  });
});

describe('screenIds', () => {
  test('marks relevant tenders as candidates and the rest as skipped with the model\'s reason', async () => {
    const src = fakeSource(4);
    await scanAll(runId, 'fake', 10, fakeDeps(src, ['T002']));
    expect(await screenIds(runId, [1, 2, 3, 4], fakeDeps(src, ['T002']))).toBe(1);
    expect(await rows('candidate')).toMatchObject([{ externalId: 'T002' }]);
    expect(await rows('skipped')).toHaveLength(3);
    expect((await rows('skipped'))[0].skipReason).toBe('not IT');
  });

  test('a tender the model gave no verdict for stays pending so the next run retries it', async () => {
    const src = fakeSource(2);
    await scanAll(runId, 'fake', 10, fakeDeps(src, []));
    const deps = fakeDeps(src, [], { screenBatch: async (b) => new Map([[b[0].externalId, { relevant: false, reason: 'no' }]]) });
    await screenIds(runId, [1, 2], deps);
    expect(await rows('pending')).toHaveLength(1);
  });
});

describe('analyseTender', () => {
  async function candidate(deps = fakeDeps(fakeSource(1), ['T001'])) {
    await scanAll(runId, 'fake', 10, deps);
    await screenIds(runId, [1], deps);
    return deps;
  }

  test('reads the documents, scores the tender and saves it as matched with its contact and document links', async () => {
    const deps = await candidate();
    await analyseTender(runId, 1, deps);
    const [t] = await rows('matched');
    expect(t).toMatchObject({ relevance: 'High', score: 72, recommendation: 'Bid - fits us', pagesRead: 2, docTender: '/pdf?file=t', docAdvertisement: '/pdf?file=a', bidSecurity: '2%' });
    expect(t.contact).toBe('A Person | a@example.com | 123');
    expect(t.analysedAt).not.toBeNull();
  });

  test('a rate limit leaves the tender a candidate with nothing half-written, and succeeds when retried', async () => {
    let calls = 0;
    const deps = await candidate();
    const flaky = { ...deps, analyse: async (...a: Parameters<typeof deps.analyse>) => { if (++calls === 1) throw new RateLimitError(37); return deps.analyse(...a); } };
    await expect(analyseTender(runId, 1, flaky)).rejects.toBeInstanceOf(RateLimitError);
    expect(await rows('candidate')).toHaveLength(1);
    expect((await rows('candidate'))[0].score).toBeNull();
    await analyseTender(runId, 1, flaky);
    expect(await rows('matched')).toHaveLength(1);
  });

  test('analysing a tender that is not a candidate does nothing', async () => {
    const deps = fakeDeps(fakeSource(1), []);
    await scanAll(runId, 'fake', 10, deps);
    await analyseTender(runId, 1, deps);
    expect(await db.select().from(tenders).where(and(eq(tenders.id, 1), eq(tenders.decision, 'pending')))).toHaveLength(1);
  });
});
