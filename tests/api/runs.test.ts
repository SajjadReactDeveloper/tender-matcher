import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createRun, finishRun, getCurrentRun, markRunning } from '@/db/queries';
import { createTestDb } from '../helpers/test-db';

const start = vi.fn(async () => ({ runId: 'wf_123' }));
vi.mock('workflow/api', () => ({ start: (...a: unknown[]) => (start as unknown as (...x: unknown[]) => unknown)(...a) }));

const json = { 'content-type': 'application/json', host: 'localhost:3000' };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/runs', { method: 'POST', headers: { ...json, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function routes() {
  vi.resetModules(); // fresh in-memory rate limiter per test
  const runsRoute = await import('@/app/api/runs/route');
  const stopRoute = await import('@/app/api/runs/stop/route');
  const { setDb } = await import('@/db/client');
  return { runsRoute, stopRoute, setDb };
}

beforeEach(async () => {
  start.mockClear();
});

describe('POST /api/runs', () => {
  test('creates a run, starts the workflow with [runId, limit] and returns the run id', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    const res = await runsRoute.POST(post({ limit: 25 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ runId: expect.any(Number) });
    expect(start).toHaveBeenCalledWith(expect.anything(), [body.runId, 25]);
    expect((await getCurrentRun())?.run.workflowRunId).toBe('wf_123');
  });

  test.each([[0], [3001], [1.5], ['abc'], [null]])('rejects limit %s with 400', async (limit) => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    const res = await runsRoute.POST(post({ limit }));
    expect(res.status).toBe(400);
    expect(start).not.toHaveBeenCalled();
  });

  test('a second start while a run is active returns 409 and starts nothing', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    await createRun(10);
    const res = await runsRoute.POST(post({ limit: 10 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A run is already in progress' });
    expect(start).not.toHaveBeenCalled();
  });

  test('rejects a cross-origin request with 403 and a non-JSON content type with 415', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    expect((await runsRoute.POST(post({ limit: 5 }, { origin: 'https://evil.com' }))).status).toBe(403);
    expect((await runsRoute.POST(post('{}', { 'content-type': 'text/plain' }))).status).toBe(415);
  });

  test('if the workflow cannot start, the run is marked failed (not left active) and the client gets a generic 500', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    start.mockRejectedValueOnce(new Error('queue down at secret-host'));
    const res = await runsRoute.POST(post({ limit: 5 }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    expect((await getCurrentRun())?.run.status).toBe('failed');
    await expect(createRun(5)).resolves.toBeDefined(); // not blocked by a stuck active run
  });

  test('the sixth start within a minute is rate limited with Retry-After', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    for (let i = 0; i < 5; i++) {
      const r = await runsRoute.POST(post({ limit: 5 }));
      expect(r.status).toBe(200);
      const cur = await getCurrentRun();
      await finishRun(cur!.run.id, 'completed');
    }
    const res = await runsRoute.POST(post({ limit: 5 }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});

describe('GET /api/runs/current', () => {
  test('returns { run: null, logs: [] } before any run and the latest run afterwards', async () => {
    const db = await createTestDb();
    const { runsRoute, setDb } = await routes();
    setDb(db);
    expect(await (await runsRoute.GET()).json()).toEqual({ run: null, logs: [] });
    const run = await createRun(5);
    const body = await (await runsRoute.GET()).json();
    expect(body.run.id).toBe(run.id);
    expect(body.logs).toEqual([]);
  });
});

describe('POST /api/runs/stop', () => {
  test('flags the active run, and says 409 when nothing is running', async () => {
    const db = await createTestDb();
    const { stopRoute, setDb } = await routes();
    setDb(db);
    const req = () => new Request('http://localhost:3000/api/runs/stop', { method: 'POST', headers: { host: 'localhost:3000' } });
    expect((await stopRoute.POST(req())).status).toBe(409);
    const run = await createRun(5);
    await markRunning(run.id);
    expect((await stopRoute.POST(req())).status).toBe(200);
    expect((await getCurrentRun())?.run.stopRequested).toBe(true);
  });

  test('rejects a cross-origin stop with 403', async () => {
    const db = await createTestDb();
    const { stopRoute, setDb } = await routes();
    setDb(db);
    const res = await stopRoute.POST(new Request('http://localhost:3000/api/runs/stop', { method: 'POST', headers: { host: 'localhost:3000', origin: 'https://evil.com' } }));
    expect(res.status).toBe(403);
  });
});
