import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { tenders } from '@/db/schema';
import { createRun, getCurrentRun } from '@/db/queries';
import type { Db } from '@/db/client';
import { analyseTender, screenIds } from '@/jobs/pipeline';
import { buildIo } from '@/jobs/io';
import { orchestrate } from '@/jobs/orchestrate';
import { classifyError } from '@/jobs/errors';
import { AiError, RateLimitError } from '@/ai/llm';
import { SourceShapeError } from '@/sources/types';
import { createTestDb } from '../helpers/test-db';
import { fakeDeps, fakeSource, scanAll } from '../helpers/fakes';

let db: Db;
let runId: number;
beforeEach(async () => {
  db = await createTestDb();
  runId = (await createRun(100)).id;
});

describe('a listing that shrinks while it is being scanned', () => {
  test('an empty page after the first is the end of the listing, not a failed run', async () => {
    // total says 120 (3 pages of 50) but tenders closed meanwhile, so page 3 comes back empty
    const src = fakeSource(100, { pageSize: 50 });
    const real = src.listPage;
    src.listPage = async (page) => ({ total: 120, tenders: (await real(page)).tenders });
    const added = await scanAll(runId, 'fake', 500, fakeDeps(src, []));
    expect(added).toBe(100);
    expect(await db.select().from(tenders)).toHaveLength(100);
  });

  test('a source whose FIRST page has no tenders still fails the run with a clear message', async () => {
    const src = fakeSource(3);
    src.listPage = async () => { throw new SourceShapeError('source returned no tenders'); };
    await orchestrate(buildIo(fakeDeps(src, [])), runId, 10);
    expect((await getCurrentRun())?.run).toMatchObject({ status: 'failed', error: 'source returned no tenders' });
  });
});

describe('analysis that can never succeed', () => {
  const candidate = async (deps = fakeDeps(fakeSource(1), ['T001'])) => {
    await scanAll(runId, 'fake', 10, deps);
    await screenIds(runId, [1], deps);
    return deps;
  };

  test('a non-retryable AI error (for example "too large") marks the tender skipped as "analysis failed" instead of leaving it to burn quota every run', async () => {
    const deps = await candidate();
    const bad = { ...deps, analyse: async () => { throw new AiError('AI API 400: request too large', { status: 400, retryable: false }); } };
    await expect(analyseTender(runId, 1, bad)).resolves.toBeUndefined();
    const [t] = await db.select().from(tenders).where(eq(tenders.id, 1));
    expect(t.decision).toBe('skipped');
    expect(t.skipReason).toMatch(/^analysis failed: .*too large/);
  });

  test('a rejected API key (401) or a rate limit still propagates and leaves the tender a candidate', async () => {
    const deps = await candidate();
    const unauthorised = { ...deps, analyse: async () => { throw new AiError('AI API 401: bad key', { status: 401, retryable: false }); } };
    await expect(analyseTender(runId, 1, unauthorised)).rejects.toThrow('401');
    const limited = { ...deps, analyse: async () => { throw new RateLimitError(30); } };
    await expect(analyseTender(runId, 1, limited)).rejects.toBeInstanceOf(RateLimitError);
    expect((await db.select().from(tenders).where(eq(tenders.id, 1)))[0].decision).toBe('candidate');
  });

  test('a retryable AI error (5xx, bad JSON) propagates so the step is retried, and the tender stays a candidate', async () => {
    const deps = await candidate();
    const flaky = { ...deps, analyse: async () => { throw new AiError('AI API 503', { status: 503, retryable: true }); } };
    await expect(analyseTender(runId, 1, flaky)).rejects.toThrow('503');
    expect((await db.select().from(tenders).where(eq(tenders.id, 1)))[0].decision).toBe('candidate');
  });
});

describe('classifyError (how a failing step is retried)', () => {
  test('a rate limit waits exactly as long as the provider asked', () => {
    expect(classifyError(new RateLimitError(37), 1)).toEqual({ kind: 'wait', seconds: 37 });
  });

  test('a changed source page, a rejected key, a missing key and an unknown provider end the run', () => {
    expect(classifyError(new SourceShapeError('source returned no tenders'), 1)).toMatchObject({ kind: 'fatal' });
    expect(classifyError(new AiError('x', { status: 401 }), 1)).toMatchObject({ kind: 'fatal' });
    expect(classifyError(new AiError('x', { status: 403 }), 1)).toMatchObject({ kind: 'fatal' });
    expect(classifyError(new AiError('GROQ_API_KEY is not set'), 1)).toMatchObject({ kind: 'fatal' });
    expect(classifyError(new AiError('Unknown AI_PROVIDER "x"'), 1)).toMatchObject({ kind: 'fatal' });
  });

  test('any other error is retried a few times and then given up on, never retried dozens of times', () => {
    expect(classifyError(new Error('network blip'), 1)).toEqual({ kind: 'retry' });
    expect(classifyError(new Error('network blip'), 3)).toEqual({ kind: 'retry' });
    expect(classifyError(new Error('network blip'), 4)).toEqual({ kind: 'give-up' });
  });

  test('a rate limit is never given up on, however many attempts it took', () => {
    expect(classifyError(new RateLimitError(5), 39)).toEqual({ kind: 'wait', seconds: 5 });
  });
});
