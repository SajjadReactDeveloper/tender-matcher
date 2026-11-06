import { beforeEach, describe, expect, test, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb, setDb } from '@/db/client';
import { listAiCalls, listAuditEvents, pruneAudit, recordAiCall, recordEvent, usageSummary } from '@/audit/store';
import { getAudit, withAudit } from '@/audit/context';
import { createTestDb } from '../helpers/test-db';

beforeEach(async () => {
  await createTestDb();
});

const call = (over = {}) => ({ purpose: 'screen' as const, provider: 'openai', model: 'gpt-4.1-mini', attempt: 1, status: 'ok' as const, images: 0, promptChars: 10, replyChars: 5, latencyMs: 120, ...over });

describe('recordEvent', () => {
  test('stores an event and redacts key-shaped secrets from its details', async () => {
    await recordEvent({ category: 'fetch', action: 'request', details: { error: 'bad key sk-abcdefghijklmnopqrstuvwxyz123456 rejected' } });
    const { rows } = await listAuditEvents({});
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].details)).not.toContain('sk-abcdef');
    expect(JSON.stringify(rows[0].details)).toContain('[redacted]');
  });

  test('never throws into the caller when the database fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDb({ insert: () => { throw new Error('db down'); } } as never);
    await expect(recordEvent({ category: 'run', action: 'started' })).resolves.toBeUndefined();
    await expect(recordAiCall(call())).resolves.toBeUndefined();
    err.mockRestore();
  });

  test('pages newest first by id with a cursor', async () => {
    for (let i = 0; i < 5; i++) await recordEvent({ category: 'run', action: `a${i}` });
    const first = await listAuditEvents({ limit: 2 });
    expect(first.rows.map((r) => r.action)).toEqual(['a4', 'a3']);
    const second = await listAuditEvents({ limit: 2, before: first.next! });
    expect(second.rows.map((r) => r.action)).toEqual(['a2', 'a1']);
  });

  test('filters by category, status and run', async () => {
    await recordEvent({ category: 'fetch', action: 'request', status: 'error', runId: undefined });
    await recordEvent({ category: 'auth', action: 'login-ok' });
    expect((await listAuditEvents({ category: 'auth' })).rows).toHaveLength(1);
    expect((await listAuditEvents({ status: 'error' })).rows[0].action).toBe('request');
  });
});

describe('recordAiCall', () => {
  test('keeps null tokens as null, not zero, and truncates long previews', async () => {
    await recordAiCall(call({ promptPreview: 'x'.repeat(9000), inputTokens: null, outputTokens: null }));
    const { rows } = await listAiCalls({});
    expect(rows[0].inputTokens).toBeNull();
    expect(rows[0].promptPreview!.length).toBeLessThanOrEqual(4000);
  });
});

describe('usageSummary', () => {
  test('sums tokens, counts rate limits and errors, and groups by model', async () => {
    await recordAiCall(call({ inputTokens: 100, outputTokens: 10 }));
    await recordAiCall(call({ inputTokens: 50, outputTokens: 5 }));
    await recordAiCall(call({ model: 'other', status: 'rate_limited' }));
    await recordAiCall(call({ model: 'other', status: 'error' }));
    const s = await usageSummary(24);
    expect(s).toMatchObject({ calls: 4, inputTokens: 150, outputTokens: 15, rateLimited: 1, errors: 1 });
    expect(s.byModel.find((m) => m.model === 'gpt-4.1-mini')).toMatchObject({ calls: 2, inputTokens: 150 });
  });
});

describe('pruneAudit', () => {
  test('deletes rows older than the retention window and keeps recent ones', async () => {
    await recordEvent({ category: 'run', action: 'old' });
    await getDb().execute(sql`update audit_events set at = now() - interval '3 days'`);
    await recordEvent({ category: 'run', action: 'fresh' });
    await pruneAudit(1);
    expect((await listAuditEvents({})).rows.map((r) => r.action)).toEqual(['fresh']);
  });
});

describe('audit context', () => {
  test('withAudit makes the run and tender visible to code it calls, including across awaits', async () => {
    await withAudit({ runId: 7, tender: 'T1' }, async () => {
      await Promise.resolve();
      expect(getAudit()).toEqual({ runId: 7, tender: 'T1' });
    });
    expect(getAudit()).toEqual({});
  });
});
