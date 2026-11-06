import { eq } from 'drizzle-orm';
import { recordEvent } from '@/audit/store';
import { getDb, withRetry } from '@/db/client';
import { apiKeys, settings } from '@/db/schema';
import { decryptSecret, encryptSecret, encryptionConfigured } from '@/lib/crypto';
import { HttpError, registerSecret } from '@/lib/security';
import { PROVIDERS, PROVIDER_IDS, isProvider, type Provider } from './models';

export type KeySource = 'dashboard' | 'env' | 'none';

export interface AiConfig {
  provider: Provider;
  textModel: string;
  visionModel: string;
  keySource: KeySource;
  apiKey: string | null;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function readSettings() {
  const [row] = await withRetry(() => getDb().select().from(settings).where(eq(settings.id, 1)));
  return row;
}

// The key for one provider: the saved (decrypted) one first, then the env var. A stored key that cannot be decrypted counts as absent.
async function resolveKey(provider: Provider): Promise<{ source: KeySource; key: string | null; last4: string | null }> {
  const [row] = await withRetry(() => getDb().select().from(apiKeys).where(eq(apiKeys.provider, provider)));
  if (row) {
    try {
      const key = decryptSecret(row, provider);
      registerSecret(key);
      return { source: 'dashboard', key, last4: row.last4 };
    } catch {
      /* fall through to env */
    }
  }
  const env = clean(process.env[PROVIDERS[provider].envKey]);
  return env ? { source: 'env', key: env, last4: env.slice(-4) } : { source: 'none', key: null, last4: null };
}

// Read on every AI call so a change on the dashboard applies to the very next request, even mid-run.
export async function getAiConfig(): Promise<AiConfig> {
  const s = await readSettings();
  const envProvider = clean(process.env.AI_PROVIDER)?.toLowerCase();
  const provider: Provider = s?.provider ?? (isProvider(envProvider) ? envProvider : 'groq');
  const p = PROVIDERS[provider];
  const k = await resolveKey(provider);
  return {
    provider,
    textModel: clean(s?.textModel) ?? (s ? null : clean(process.env.TEXT_MODEL)) ?? p.defaultText,
    visionModel: clean(s?.visionModel) ?? (s ? null : clean(process.env.VISION_MODEL)) ?? p.defaultVision,
    keySource: k.source,
    apiKey: k.key,
  };
}

export async function saveSettings(next: { provider: Provider; textModel?: string | null; visionModel?: string | null }): Promise<void> {
  const before = await getAiConfig();
  const values = { id: 1, provider: next.provider, textModel: clean(next.textModel), visionModel: clean(next.visionModel), updatedAt: new Date() };
  await withRetry(() => getDb().insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values }));
  const after = await getAiConfig();
  if (before.provider !== after.provider) await recordEvent({ category: 'settings', action: 'provider-changed', status: 'ok', details: { from: before.provider, to: after.provider } });
  if (before.textModel !== after.textModel || before.visionModel !== after.visionModel) {
    await recordEvent({ category: 'settings', action: 'model-changed', status: 'ok', details: { provider: after.provider, text: { from: before.textModel, to: after.textModel }, vision: { from: before.visionModel, to: after.visionModel } } });
  }
}

export async function saveKey(provider: Provider, plain: string): Promise<{ last4: string }> {
  const key = plain.trim();
  if (key.length < 8 || key.length > 500 || /\s/.test(key)) throw new HttpError(400, 'That does not look like an API key (8-500 characters, no spaces)');
  const sealed = encryptSecret(key, provider); // throws 503 before anything is stored when encryption is not configured
  const last4 = key.slice(-4);
  const values = { provider, ...sealed, last4, updatedAt: new Date() };
  await withRetry(() => getDb().insert(apiKeys).values(values).onConflictDoUpdate({ target: apiKeys.provider, set: values }));
  await recordEvent({ category: 'settings', action: 'key-saved', status: 'ok', ref: provider, details: { provider, last4 } });
  return { last4 };
}

export async function removeKey(provider: Provider): Promise<void> {
  await withRetry(() => getDb().delete(apiKeys).where(eq(apiKeys.provider, provider)));
  await recordEvent({ category: 'settings', action: 'key-removed', status: 'ok', ref: provider, details: { provider } });
}

export async function keyStatus(): Promise<{ provider: Provider; configured: boolean; last4: string | null; source: KeySource }[]> {
  const out = [];
  for (const provider of PROVIDER_IDS) {
    const k = await resolveKey(provider);
    out.push({ provider, configured: k.key !== null, last4: k.last4, source: k.source });
  }
  return out;
}

export async function publicSettings() {
  const cfg = await getAiConfig();
  return {
    provider: cfg.provider,
    textModel: cfg.textModel,
    visionModel: cfg.visionModel,
    providers: PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label, defaultText: PROVIDERS[id].defaultText, defaultVision: PROVIDERS[id].defaultVision, textModels: PROVIDERS[id].textModels, visionModels: PROVIDERS[id].visionModels })),
    keys: await keyStatus(),
    encryptionConfigured: encryptionConfigured(),
  };
}
