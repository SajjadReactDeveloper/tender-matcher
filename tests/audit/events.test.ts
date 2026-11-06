import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listAuditEvents } from '@/audit/store';
import { createRun, finishRun, markRunning, requestStop } from '@/db/queries';
import { analyseTender, screenIds } from '@/jobs/pipeline';
import { attemptLogin } from '@/lib/auth/login';
import { hashPassword } from '@/lib/auth/password';
import { fetchBuffer } from '@/sources/http';
import { createTestDb } from '../helpers/test-db';
import { fakeDeps, fakeSource, scanAll } from '../helpers/fakes';

beforeEach(async () => {
  await createTestDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const events = async (category: string) => (await listAuditEvents({ category })).rows.reverse();

describe('fetch events', () => {
  test('a download is recorded with its status, size and attempt; a retry records the failure then the success', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      if (++calls === 1) throw new Error('network down');
      return new Response('hello world');
    });
    await fetchBuffer('https://example.com/a.pdf', { retries: 1, retryDelayMs: 0 });
    const rows = await events('fetch');
    expect(rows.map((r) => [r.action, r.status])).toEqual([['request', 'error'], ['request', 'ok']]);
    expect(rows[1].details).toMatchObject({ url: 'https://example.com/a.pdf', status: 200, bytes: 11, attempt: 2 });
    expect(rows[0].details).toMatchObject({ attempt: 1, error: 'network down' });
    expect(rows[1].durationMs).toBeTypeOf('number');
  });
});

describe('run events', () => {
  test('the pipeline records page, screening and analysis events with counts, tied to the run', async () => {
    const run = await createRun(10);
    const src = fakeSource(3);
    const deps = fakeDeps(src, ['T001']);
    await scanAll(run.id, 'fake', 10, deps);
    await screenIds(run.id, [1, 2, 3], deps);
    await analyseTender(run.id, 1, deps);
    const rows = (await events('run')).filter((r) => r.action !== 'queued');
    expect(rows.map((r) => r.action)).toEqual(['page-scanned', 'screened', 'analysed']);
    expect(rows[0]).toMatchObject({ runId: run.id, details: { source: 'fake', page: 1, listed: 3, added: 3 } });
    expect(rows[1].details).toMatchObject({ judged: 3, relevant: 1 });
    expect(rows[2]).toMatchObject({ ref: 'T001', details: { relevance: 'High', score: 72, pages: 2 } });
  });

  test('run lifecycle: queued, started, stop requested, forced stop, finished', async () => {
    const run = await createRun(5);
    await markRunning(run.id);
    await requestStop();
    await requestStop();
    const acts = (await events('run')).map((r) => r.action);
    expect(acts).toEqual(['queued', 'started', 'stop-requested', 'force-stopped', 'cancelled']);
    const run2 = await createRun(5);
    await finishRun(run2.id, 'failed', 'boom');
    expect((await events('run')).pop()).toMatchObject({ action: 'failed', status: 'error', details: { error: 'boom' } });
  });
});

describe('auth events', () => {
  beforeEach(async () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
    vi.stubEnv('APP_EMAIL', 'me@example.com');
    vi.stubEnv('APP_PASSWORD_HASH', await hashPassword('right-password'));
  });

  test('login success and failure record the ip and user agent but never the password', async () => {
    await attemptLogin({ email: 'me@example.com', password: 'wrong-password-xyz', ip: '1.2.3.4', userAgent: 'TestBrowser/1' });
    await attemptLogin({ email: 'me@example.com', password: 'right-password', ip: '1.2.3.4', userAgent: 'TestBrowser/1' });
    const rows = await events('auth');
    expect(rows.map((r) => [r.action, r.status])).toEqual([['login-failed', 'error'], ['login-ok', 'ok']]);
    expect(rows[0].details).toMatchObject({ ip: '1.2.3.4', userAgent: 'TestBrowser/1', emailMatched: true });
    expect(JSON.stringify(rows)).not.toContain('wrong-password-xyz');
    expect(JSON.stringify(rows)).not.toContain('right-password');
  });

  test('a blocked attempt is recorded as rate-limited', async () => {
    for (let i = 0; i < 6; i++) await attemptLogin({ email: 'me@example.com', password: 'bad', ip: '5.5.5.5' });
    expect((await events('auth')).map((r) => r.action).at(-1)).toBe('login-blocked');
  });
});
