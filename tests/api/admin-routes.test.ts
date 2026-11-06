import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as settingsRoute from '@/app/api/settings/route';
import * as keyRoute from '@/app/api/settings/keys/[provider]/route';
import * as testRoute from '@/app/api/settings/test/route';
import * as auditRoute from '@/app/api/audit/route';
import * as exportRoute from '@/app/api/audit/export/route';
import * as historyRoute from '@/app/api/history/route';
import * as detailRoute from '@/app/api/history/[id]/route';
import * as usageRoute from '@/app/api/usage/route';
import { recordAiCall, recordEvent } from '@/audit/store';
import { createRun } from '@/db/queries';
import { createTestDb } from '../helpers/test-db';
import { signedIn } from '../helpers/auth';

let auth = {} as { cookie: string };
const H = { host: 'localhost:3000' };
const req = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signedIn?: boolean } = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: init.method ?? 'GET',
    headers: { ...H, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.signedIn === false ? {} : auth), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const call = (over = {}) => ({ purpose: 'screen' as const, provider: 'groq', model: 'm', attempt: 1, status: 'ok' as const, images: 0, promptChars: 1, replyChars: 1, latencyMs: 5, ...over });

beforeEach(async () => {
  await createTestDb();
  auth = await signedIn();
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  for (const k of ['AI_PROVIDER', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TEXT_MODEL', 'VISION_MODEL']) vi.stubEnv(k, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('every admin route needs a session', () => {
  test.each([
    ['settings GET', () => settingsRoute.GET(req('/api/settings', { signedIn: false }))],
    ['settings PUT', () => settingsRoute.PUT(req('/api/settings', { method: 'PUT', body: { provider: 'groq' }, signedIn: false }))],
    ['key PUT', () => keyRoute.PUT(req('/api/settings/keys/groq', { method: 'PUT', body: { key: 'x'.repeat(20) }, signedIn: false }), ctx({ provider: 'groq' }))],
    ['key DELETE', () => keyRoute.DELETE(req('/api/settings/keys/groq', { method: 'DELETE', signedIn: false }), ctx({ provider: 'groq' }))],
    ['test POST', () => testRoute.POST(req('/api/settings/test', { method: 'POST', body: {}, signedIn: false }))],
    ['audit GET', () => auditRoute.GET(req('/api/audit', { signedIn: false }))],
    ['export GET', () => exportRoute.GET(req('/api/audit/export', { signedIn: false }))],
    ['history GET', () => historyRoute.GET(req('/api/history', { signedIn: false }))],
    ['detail GET', () => detailRoute.GET(req('/api/history/1', { signedIn: false }), ctx({ id: '1' }))],
    ['usage GET', () => usageRoute.GET(req('/api/usage', { signedIn: false }))],
  ])('%s returns 401 without a cookie', async (_n, run) => {
    expect((await run()).status).toBe(401);
  });
});

describe('settings', () => {
  test('PUT saves provider and models and GET reflects them with the provider catalogue and key status', async () => {
    const res = await settingsRoute.PUT(req('/api/settings', { method: 'PUT', body: { provider: 'openai', textModel: 'gpt-4.1', visionModel: null } }));
    expect(res.status).toBe(200);
    const body = await (await settingsRoute.GET(req('/api/settings'))).json();
    expect(body).toMatchObject({ provider: 'openai', textModel: 'gpt-4.1', visionModel: 'gpt-4.1-mini', encryptionConfigured: true });
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(['groq', 'openai', 'anthropic']);
  });

  test('rejects an unknown provider and a model id with odd characters', async () => {
    expect((await settingsRoute.PUT(req('/api/settings', { method: 'PUT', body: { provider: 'nope' } }))).status).toBe(400);
    expect((await settingsRoute.PUT(req('/api/settings', { method: 'PUT', body: { provider: 'groq', textModel: 'bad model; drop' } }))).status).toBe(400);
  });

  test('a cross-origin change is refused', async () => {
    const res = await settingsRoute.PUT(req('/api/settings', { method: 'PUT', body: { provider: 'groq' }, headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });

  test('saving a key returns only its last 4 characters and no later response contains the key', async () => {
    const key = 'gsk_topsecretkey_abcdef123456';
    const put = await keyRoute.PUT(req('/api/settings/keys/groq', { method: 'PUT', body: { key } }), ctx({ provider: 'groq' }));
    expect(await put.json()).toEqual({ ok: true, last4: '3456' });
    const all = JSON.stringify(await (await settingsRoute.GET(req('/api/settings'))).json()) + JSON.stringify(await (await auditRoute.GET(req('/api/audit?category=settings'))).json());
    expect(all).not.toContain('topsecret');
    expect(all).toContain('3456');
  });

  test('saving a key without SETTINGS_ENCRYPTION_KEY is a 503, an unknown provider is a 404, and deleting removes the key', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', '');
    expect((await keyRoute.PUT(req('/api/settings/keys/groq', { method: 'PUT', body: { key: 'gsk_abcdefgh12345678' } }), ctx({ provider: 'groq' }))).status).toBe(503);
    expect((await keyRoute.PUT(req('/api/settings/keys/nope', { method: 'PUT', body: { key: 'gsk_abcdefgh12345678' } }), ctx({ provider: 'nope' }))).status).toBe(404);
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    await keyRoute.PUT(req('/api/settings/keys/groq', { method: 'PUT', body: { key: 'gsk_abcdefgh12345678' } }), ctx({ provider: 'groq' }));
    await keyRoute.DELETE(req('/api/settings/keys/groq', { method: 'DELETE' }), ctx({ provider: 'groq' }));
    const body = await (await settingsRoute.GET(req('/api/settings'))).json();
    expect(body.keys.find((k: { provider: string }) => k.provider === 'groq')).toMatchObject({ configured: false });
  });

  test('test connection reports latency and tokens on success and the error on failure, with no key in the reply', async () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_envkey1234567890abcd');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 9, completion_tokens: 1 } }), { status: 200 }));
    expect(await (await testRoute.POST(req('/api/settings/test', { method: 'POST', body: {} }))).json()).toMatchObject({ ok: true, model: 'openai/gpt-oss-120b', inputTokens: 9, outputTokens: 1 });
    vi.stubGlobal('fetch', async () => new Response('Invalid key gsk_envkey1234567890abcd', { status: 401 }));
    const bad = await (await testRoute.POST(req('/api/settings/test', { method: 'POST', body: {} }))).json();
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain('envkey1234567890abcd');
  });
});

describe('audit and usage', () => {
  test('filters events by category and pages with a cursor', async () => {
    for (let i = 0; i < 3; i++) await recordEvent({ category: 'fetch', action: `f${i}` });
    await recordEvent({ category: 'auth', action: 'login-ok' });
    const fetchOnly = await (await auditRoute.GET(req('/api/audit?category=fetch&limit=2'))).json();
    expect(fetchOnly.rows.map((r: { action: string }) => r.action)).toEqual(['f2', 'f1']);
    const more = await (await auditRoute.GET(req(`/api/audit?category=fetch&limit=2&before=${fetchOnly.next}`))).json();
    expect(more.rows.map((r: { action: string }) => r.action)).toEqual(['f0']);
  });

  test('kind=ai lists AI calls with tokens, and a bad filter is a 400', async () => {
    await recordAiCall(call({ inputTokens: 12, outputTokens: 3 }));
    const body = await (await auditRoute.GET(req('/api/audit?kind=ai'))).json();
    expect(body.rows[0]).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    expect((await auditRoute.GET(req('/api/audit?category=bogus'))).status).toBe(400);
    expect((await auditRoute.GET(req('/api/audit?from=not-a-date'))).status).toBe(400);
  });

  test('CSV export neutralizes cells that start with a formula character', async () => {
    await recordEvent({ category: 'fetch', action: '=HYPERLINK("http://evil")' });
    const res = await exportRoute.GET(req('/api/audit/export'));
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  test('usage sums the window and rejects other windows', async () => {
    await recordAiCall(call({ inputTokens: 100, outputTokens: 20 }));
    expect(await (await usageRoute.GET(req('/api/usage?hours=24'))).json()).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20 });
    expect((await usageRoute.GET(req('/api/usage?hours=5'))).status).toBe(400);
  });
});

describe('history', () => {
  test('lists runs with token totals and returns a run detail with logs, AI calls and events; unknown id is 404', async () => {
    const run = await createRun(10);
    await recordAiCall(call({ runId: run.id, inputTokens: 40, outputTokens: 5 }));
    await recordAiCall(call({ runId: run.id, inputTokens: 60, outputTokens: 5 }));
    const list = await (await historyRoute.GET(req('/api/history'))).json();
    expect(list.runs[0]).toMatchObject({ id: run.id, aiCalls: 2, inputTokens: 100, outputTokens: 10 });
    const detail = await (await detailRoute.GET(req(`/api/history/${run.id}`), ctx({ id: String(run.id) }))).json();
    expect(detail.aiCalls).toHaveLength(2);
    expect(detail.events.map((e: { action: string }) => e.action)).toContain('queued');
    expect((await detailRoute.GET(req('/api/history/999'), ctx({ id: '999' }))).status).toBe(404);
    expect((await detailRoute.GET(req('/api/history/abc'), ctx({ id: 'abc' }))).status).toBe(404);
  });
});
