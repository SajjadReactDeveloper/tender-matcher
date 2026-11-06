import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { runs, tenders } from '@/db/schema';
import { createRun, getCurrentRun, requestStop } from '@/db/queries';
import type { Db } from '@/db/client';
import { buildIo } from '@/jobs/io';
import { orchestrate } from '@/jobs/orchestrate';
import { SourceShapeError } from '@/sources/types';
import { createTestDb } from '../helpers/test-db';
import { fakeDeps, fakeSource } from '../helpers/fakes';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const count = async (decision: 'matched' | 'skipped' | 'pending' | 'candidate') => (await db.select().from(tenders).where(eq(tenders.decision, decision))).length;

describe('a full run with a fake source and fake AI', () => {
  test('45 tenders with 3 relevant produce 3 matched and 42 skipped, and the run completes with counters and logs', async () => {
    const deps = fakeDeps(fakeSource(45), ['T003', 'T020', 'T044']);
    const run = await createRun(100);
    await orchestrate(buildIo(deps), run.id, 100);
    expect(await count('matched')).toBe(3);
    expect(await count('skipped')).toBe(42);
    const cur = await getCurrentRun();
    expect(cur?.run).toMatchObject({ status: 'completed', screened: 45, matched: 3 });
    expect(cur?.logs.length).toBeGreaterThan(3);
  });

  test('a second run does not re-screen known tenders', async () => {
    const deps = fakeDeps(fakeSource(10), ['T001']);
    await orchestrate(buildIo(deps), (await createRun(100)).id, 100);
    let screenedAgain = 0;
    const deps2 = { ...deps, screenBatch: async (...a: Parameters<typeof deps.screenBatch>) => { screenedAgain += a[0].length; return deps.screenBatch(...a); } };
    await orchestrate(buildIo(deps2), (await createRun(100)).id, 100);
    expect(screenedAgain).toBe(0);
    expect(await count('matched')).toBe(1);
  });

  test('work left over from an interrupted run (pending and candidate rows) is finished by the next run', async () => {
    const src = fakeSource(6);
    const deps = fakeDeps(src, ['T001', 'T002']);
    const io = buildIo(deps);
    const first = await createRun(100);
    await io.scan(first.id, 'fake', 100);
    await io.screen(first.id, await io.pendingIds(100).then((ids) => ids.slice(0, 3))); // run died after screening 3
    await db.update(runs).set({ status: 'failed' }).where(eq(runs.id, first.id));
    await orchestrate(buildIo(deps), (await createRun(100)).id, 100);
    expect(await count('pending')).toBe(0);
    expect(await count('candidate')).toBe(0);
    expect(await count('matched')).toBe(2);
  });

  test('a stop request ends the run cancelled with only whole tenders saved', async () => {
    const deps = fakeDeps(fakeSource(10), ['T001', 'T002', 'T003']);
    let analysed = 0;
    const io = buildIo({ ...deps, analyse: async (...a) => { analysed++; await requestStop(); return deps.analyse(...a); } });
    const run = await createRun(100);
    await orchestrate(io, run.id, 100);
    expect((await getCurrentRun())?.run.status).toBe('cancelled');
    expect(analysed).toBe(1);
    const matched = await db.select().from(tenders).where(eq(tenders.decision, 'matched'));
    expect(matched).toHaveLength(1);
    expect(matched[0].score).toBe(72);
    expect(await count('candidate')).toBe(2);
  });

  test('a source whose page shape changed fails the run with a clear message instead of completing with zero', async () => {
    const src = fakeSource(3);
    src.listPage = async () => { throw new SourceShapeError('source returned no tenders'); };
    const run = await createRun(100);
    await orchestrate(buildIo(fakeDeps(src, [])), run.id, 100);
    expect((await getCurrentRun())?.run).toMatchObject({ status: 'failed', error: 'source returned no tenders' });
  });

  test('a tender whose analysis keeps failing is logged and left a candidate; the others still match', async () => {
    const deps = fakeDeps(fakeSource(3), ['T001', 'T002']);
    let failures = 0;
    const bad = buildIo({ ...deps, readDocuments: async (...a) => { if (failures++ === 0) throw new Error('bad pdf'); return deps.readDocuments(...a); } });
    const run = await createRun(100);
    await orchestrate(bad, run.id, 100);
    expect(await count('matched')).toBe(1);
    expect(await count('candidate')).toBe(1);
    expect((await getCurrentRun())?.logs.some((l) => l.message.includes('bad pdf'))).toBe(true);
    expect((await getCurrentRun())?.run.status).toBe('completed');
  });
});
