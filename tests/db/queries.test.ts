import { beforeEach, describe, expect, test } from 'vitest';
import { appendLog, createRun, finishRun, getCurrentRun, isStopRequested, markRunning, requestStop } from '@/db/queries';
import { HttpError } from '@/lib/security';
import { createTestDb } from '../helpers/test-db';

beforeEach(async () => {
  await createTestDb();
});

describe('runs', () => {
  test('createRun while another run is active throws a 409 HttpError; after it finishes a new one is allowed', async () => {
    const first = await createRun(10);
    const err = await createRun(10).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('A run is already in progress');
    await finishRun(first.id, 'completed');
    await expect(createRun(10)).resolves.toMatchObject({ status: 'queued', limit: 10 });
  });

  test('requestStop flags only the active run and returns null when none is active', async () => {
    expect(await requestStop()).toBeNull();
    const run = await createRun(5);
    await markRunning(run.id);
    expect(await isStopRequested(run.id)).toBe(false);
    expect((await requestStop())?.id).toBe(run.id);
    expect(await isStopRequested(run.id)).toBe(true);
  });

  test('finishRun records status, error and finish time', async () => {
    const run = await createRun(5);
    await finishRun(run.id, 'failed', 'source returned no tenders');
    const cur = await getCurrentRun();
    expect(cur?.run).toMatchObject({ status: 'failed', error: 'source returned no tenders' });
    expect(cur?.run.finishedAt).not.toBeNull();
  });

  test('getCurrentRun returns null with no runs and otherwise the latest run with its last 300 log lines in order', async () => {
    expect(await getCurrentRun()).toBeNull();
    const run = await createRun(5);
    for (let i = 1; i <= 305; i++) await appendLog(run.id, `line ${i}`);
    const cur = await getCurrentRun();
    expect(cur?.logs).toHaveLength(300);
    expect(cur?.logs[0].message).toBe('line 6');
    expect(cur?.logs[299].message).toBe('line 305');
  });

  test('appendLog redacts secrets', async () => {
    const run = await createRun(5);
    await appendLog(run.id, 'failed with key sk-proj_ABCDEFGHIJKLMNOP1234');
    expect((await getCurrentRun())?.logs[0].message).toBe('failed with key [redacted]');
  });
});
