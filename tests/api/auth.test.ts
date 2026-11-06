import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SESSION_COOKIE, createSession } from '@/lib/auth/session';
import { createTestDb } from '../helpers/test-db';

vi.mock('workflow/api', () => ({ start: async () => ({ runId: 'wf_1' }) }));

// Every route handler checks the session itself: proxy.ts is the first gate, not the only one.
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
  await createTestDb();
});
afterEach(() => vi.unstubAllEnvs());

const url = 'http://localhost:3000';
const json = { 'content-type': 'application/json', host: 'localhost:3000' };

async function handlers(): Promise<[string, (cookie?: string) => Promise<Response>][]> {
  const tenders = await import('@/app/api/tenders/route');
  const exp = await import('@/app/api/export/route');
  const runs = await import('@/app/api/runs/route');
  const stop = await import('@/app/api/runs/stop/route');
  const mk = (path: string, method: string, body?: string) => (cookie?: string) =>
    new Request(url + path, { method, body, headers: { ...json, ...(cookie ? { cookie } : {}) } });
  return [
    ['GET /api/tenders', (c) => tenders.GET(mk('/api/tenders', 'GET')(c))],
    ['GET /api/export', (c) => exp.GET(mk('/api/export', 'GET')(c))],
    ['GET /api/runs', (c) => runs.GET(mk('/api/runs', 'GET')(c))],
    ['POST /api/runs', (c) => runs.POST(mk('/api/runs', 'POST', '{"limit":5}')(c))],
    ['POST /api/runs/stop', (c) => stop.POST(mk('/api/runs/stop', 'POST')(c))],
  ];
}

describe('route handlers enforce the session themselves', () => {
  test('without a cookie every handler answers 401 JSON', async () => {
    for (const [name, call] of await handlers()) {
      const res = await call();
      expect(res.status, name).toBe(401);
      expect(await res.json(), name).toEqual({ error: 'Not signed in' });
    }
  });

  test('a tampered or expired cookie is also a 401', async () => {
    const good = await createSession('me@example.com');
    const tampered = `${SESSION_COOKIE}=${good.slice(0, -3)}abc`;
    const expired = `${SESSION_COOKIE}=${await createSession('me@example.com', -5)}`;
    for (const [name, call] of await handlers()) {
      expect((await call(tampered)).status, name).toBe(401);
      expect((await call(expired)).status, name).toBe(401);
    }
  });

  test('with a valid cookie the handlers do their job (no 401)', async () => {
    const cookie = `${SESSION_COOKIE}=${await createSession('me@example.com')}`;
    const tenders = (await handlers())[0][1];
    expect((await tenders(cookie)).status).toBe(200);
  });
});
