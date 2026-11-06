import { describe, expect, test } from 'vitest';
import { withRetry } from '@/db/client';

describe('withRetry', () => {
  test('retries a connection error once then returns the result', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
      return 'ok';
    }, 0);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  test('gives up after two retries', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error('fetch failed');
      }, 0),
    ).rejects.toThrow('fetch failed');
    expect(calls).toBe(3);
  });

  test('does not retry non-connection errors such as constraint violations', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }, 0),
    ).rejects.toThrow('duplicate key');
    expect(calls).toBe(1);
  });
});
