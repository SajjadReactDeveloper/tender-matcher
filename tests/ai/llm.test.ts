import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AiError, RateLimitError, chat, parseJsonReply } from '@/ai/llm';
import { stubAiReply, stubAiStatus } from '../helpers/ai';
import { createTestDb } from '../helpers/test-db';

beforeEach(async () => {
  await createTestDb();
  vi.stubEnv('AI_PROVIDER', 'groq');
  vi.stubEnv('GROQ_API_KEY', 'test-groq-key-1234567890');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseJsonReply', () => {
  test('strips <think> blocks and finds the JSON object', () => {
    expect(parseJsonReply('<think>hmm</think>{"a":1}')).toEqual({ a: 1 });
  });
  test('throws AiError when there is no JSON', () => {
    expect(() => parseJsonReply('no json here')).toThrowError(AiError);
  });
});

describe('chat', () => {
  test('returns the reply text with <think> blocks removed', async () => {
    stubAiReply('<think>plan</think>Hello');
    expect(await chat({ purpose: 'screen', system: 's', user: 'u' })).toBe('Hello');
  });

  test('parses JSON replies when json: true', async () => {
    stubAiReply({ ok: true });
    expect(await chat({ purpose: 'screen', system: 's', user: 'u', json: true })).toEqual({ ok: true });
  });

  test('a 429 becomes RateLimitError carrying the provider wait time', async () => {
    stubAiStatus(429, '{"error":"slow down"}', { 'retry-after': '37' });
    const err = await chat({ purpose: 'screen', system: 's', user: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSeconds).toBe(37);
  });

  test('a 500 is a retryable AiError, a 401 is not', async () => {
    stubAiStatus(500, 'boom');
    expect(await chat({ purpose: 'screen', system: 's', user: 'u' }).catch((e) => e)).toMatchObject({ name: 'AiError', retryable: true });
    stubAiStatus(401, 'nope');
    expect(await chat({ purpose: 'screen', system: 's', user: 'u' }).catch((e) => e)).toMatchObject({ name: 'AiError', retryable: false });
  });

  test('error messages never contain the API key even if the provider echoes it', async () => {
    stubAiStatus(401, 'Invalid key test-groq-key-1234567890');
    const err = await chat({ purpose: 'screen', system: 's', user: 'u' }).catch((e) => e);
    expect(err.message).not.toContain('test-groq-key-1234567890');
  });

  test('names the missing key variable when none is configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    await expect(chat({ purpose: 'screen', system: 's', user: 'u' })).rejects.toThrow('No API key for Groq');
  });
});
