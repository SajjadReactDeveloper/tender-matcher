import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { listAuditEvents } from '@/audit/store';
import { getAiConfig, keyStatus, removeKey, saveKey, saveSettings } from '@/settings/store';
import { HttpError } from '@/lib/security';
import { createTestDb } from '../helpers/test-db';

const ENC = Buffer.alloc(32, 7).toString('base64');

beforeEach(async () => {
  await createTestDb();
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', ENC);
  for (const k of ['AI_PROVIDER', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TEXT_MODEL', 'VISION_MODEL']) vi.stubEnv(k, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('getAiConfig', () => {
  test('with nothing saved or set: groq, its default models and no key', async () => {
    expect(await getAiConfig()).toMatchObject({ provider: 'groq', textModel: 'openai/gpt-oss-120b', keySource: 'none', apiKey: null });
  });

  test('env values are the fallback; a saved dashboard key and settings win over them', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-key-aaaaaaaaaaaa');
    expect(await getAiConfig()).toMatchObject({ provider: 'openai', keySource: 'env', apiKey: 'sk-env-key-aaaaaaaaaaaa' });
    await saveKey('openai', 'sk-dashboard-key-bbbbbbbb');
    await saveSettings({ provider: 'openai', textModel: 'gpt-4.1', visionModel: null });
    expect(await getAiConfig()).toMatchObject({ provider: 'openai', textModel: 'gpt-4.1', visionModel: 'gpt-4.1-mini', keySource: 'dashboard', apiKey: 'sk-dashboard-key-bbbbbbbb' });
  });

  test('a corrupted stored key is treated as absent and falls back to the env key instead of crashing', async () => {
    await saveKey('groq', 'gsk_dashboardkey12345678');
    await getDb().update(apiKeys).set({ ciphertext: 'AAAA' }).where(eq(apiKeys.provider, 'groq'));
    vi.stubEnv('GROQ_API_KEY', 'gsk_envkey1234567890');
    expect(await getAiConfig()).toMatchObject({ keySource: 'env', apiKey: 'gsk_envkey1234567890' });
  });
});

describe('keys', () => {
  test('keyStatus shows last4 and the source but never the key itself', async () => {
    await saveKey('anthropic', 'sk-ant-supersecret-9876');
    const status = await keyStatus();
    expect(status.find((s) => s.provider === 'anthropic')).toMatchObject({ configured: true, last4: '9876', source: 'dashboard' });
    expect(JSON.stringify(status)).not.toContain('supersecret');
    await removeKey('anthropic');
    expect((await keyStatus()).find((s) => s.provider === 'anthropic')).toMatchObject({ configured: false, source: 'none' });
  });

  test('saving without SETTINGS_ENCRYPTION_KEY fails with 503 and stores nothing', async () => {
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', '');
    await expect(saveKey('groq', 'gsk_abcdefgh12345678')).rejects.toMatchObject({ status: 503 });
    expect(await getDb().select().from(apiKeys)).toHaveLength(0);
  });

  test('rejects keys with whitespace, too short or too long', async () => {
    for (const bad of ['short', 'has space inside the key', 'x'.repeat(501)]) await expect(saveKey('groq', bad)).rejects.toBeInstanceOf(HttpError);
  });

  test('settings and key changes are audited without the key', async () => {
    await saveSettings({ provider: 'openai', textModel: 'gpt-4.1', visionModel: null });
    await saveKey('openai', 'sk-audited-key-1234567890');
    const events = (await listAuditEvents({ category: 'settings' })).rows;
    expect(events.map((e) => e.action).sort()).toEqual(['key-saved', 'model-changed', 'provider-changed']);
    expect(JSON.stringify(events)).not.toContain('audited-key');
    expect(JSON.stringify(events)).toContain('7890');
  });
});
