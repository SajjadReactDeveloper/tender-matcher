import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RateLimitError, chat } from '@/ai/llm';
import { withAudit } from '@/audit/context';
import { listAiCalls } from '@/audit/store';
import { getDb, setDb } from '@/db/client';
import { saveKey, saveSettings } from '@/settings/store';
import { createTestDb } from '../helpers/test-db';

const reply = (body: unknown, init: ResponseInit = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init }));
const ok = (usage?: unknown) => ({ choices: [{ message: { content: 'hi' } }], ...(usage ? { usage } : {}) });

beforeEach(async () => {
  await createTestDb();
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  for (const k of ['AI_PROVIDER', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TEXT_MODEL', 'VISION_MODEL']) vi.stubEnv(k, '');
  vi.stubEnv('GROQ_API_KEY', 'gsk_envkey1234567890abcd');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const last = async () => (await listAiCalls({})).rows[0];

describe('chat usage and audit', () => {
  test('stores OpenAI-style token usage, model, run and tender from the audit context', async () => {
    vi.stubGlobal('fetch', reply(ok({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 })));
    await withAudit({ runId: 4, tender: 'TS1E' }, () => chat({ system: 's', user: 'u', purpose: 'screen' }));
    expect(await last()).toMatchObject({ status: 'ok', provider: 'groq', model: 'openai/gpt-oss-120b', purpose: 'screen', runId: 4, tenderExternalId: 'TS1E', inputTokens: 120, outputTokens: 30, totalTokens: 150, replyPreview: 'hi' });
  });

  test('stores Anthropic-style usage', async () => {
    await saveSettings({ provider: 'anthropic' });
    await saveKey('anthropic', 'sk-ant-key-1234567890');
    vi.stubGlobal('fetch', reply({ content: [{ text: 'hello' }], usage: { input_tokens: 11, output_tokens: 4 } }));
    expect(await chat({ system: 's', user: 'u', purpose: 'analyse' })).toBe('hello');
    expect(await last()).toMatchObject({ provider: 'anthropic', inputTokens: 11, outputTokens: 4, totalTokens: 15 });
  });

  test('a reply without usage stores null tokens, not zero', async () => {
    vi.stubGlobal('fetch', reply(ok()));
    await chat({ system: 's', user: 'u', purpose: 'screen' });
    expect(await last()).toMatchObject({ status: 'ok', inputTokens: null, outputTokens: null, totalTokens: null });
  });

  test('a 429 is audited as rate_limited with the wait time, then still throws RateLimitError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"slow"}', { status: 429, headers: { 'retry-after': '7' } })));
    await expect(chat({ system: 's', user: 'u', purpose: 'screen' })).rejects.toBeInstanceOf(RateLimitError);
    expect(await last()).toMatchObject({ status: 'rate_limited', httpStatus: 429, retryAfterS: 7 });
  });

  test('a 500 is audited as an error with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(chat({ system: 's', user: 'u', purpose: 'screen' })).rejects.toThrow();
    expect(await last()).toMatchObject({ status: 'error', httpStatus: 500 });
  });

  test('uses the model and key saved on the dashboard, not the env ones, and sends the saved key', async () => {
    await saveSettings({ provider: 'openai', textModel: 'gpt-4.1' });
    await saveKey('openai', 'sk-dashboard-key-abcdefgh');
    const f = reply(ok({ prompt_tokens: 1000, completion_tokens: 1000 }));
    vi.stubGlobal('fetch', f);
    await chat({ system: 's', user: 'u', purpose: 'screen' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('api.openai.com');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-dashboard-key-abcdefgh');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4.1');
    expect(Number((await last()).estCostUsd)).toBeCloseTo(0.01, 4);
  });

  test('stored previews never contain the API key', async () => {
    vi.stubGlobal('fetch', reply({ choices: [{ message: { content: 'echo gsk_envkey1234567890abcd' } }] }));
    await chat({ system: 's', user: 'my key is gsk_envkey1234567890abcd', purpose: 'screen' });
    const row = await last();
    expect(JSON.stringify(row)).not.toContain('envkey1234567890abcd');
  });

  test('with no key anywhere it throws a clear error and calls nothing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const f = reply(ok());
    vi.stubGlobal('fetch', f);
    await expect(chat({ system: 's', user: 'u', purpose: 'screen' })).rejects.toThrow(/No API key for Groq/);
    expect(f).not.toHaveBeenCalled();
  });

  test('a failing audit insert does not break the AI call', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = getDb();
    setDb(new Proxy(real, { get: (t, p) => (p === 'insert' ? () => { throw new Error('audit down'); } : (t as never)[p]) }) as never);
    vi.stubGlobal('fetch', reply(ok()));
    await expect(chat({ system: 's', user: 'u', purpose: 'screen' })).resolves.toBe('hi');
  });
});
