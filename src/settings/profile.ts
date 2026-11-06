import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { recordEvent } from '@/audit/store';
import { getDb, withRetry } from '@/db/client';
import { appProfile } from '@/db/schema';
import { HttpError } from '@/lib/security';

// Sent with every screening and analysis prompt, so it is capped: a huge profile would be paid for on every AI call.
export const MAX_PROFILE_CHARS = 20000;

export type ProfileSource = 'saved' | 'default';

// The profile file shipped with the app (config/profile.md): used until a profile is saved on the Settings page.
const fileProfile = (): string => readFileSync(join(process.cwd(), 'config', 'profile.md'), 'utf8');

export async function getProfile(): Promise<{ text: string; source: ProfileSource }> {
  const [row] = await withRetry(() => getDb().select().from(appProfile).where(eq(appProfile.id, 1)));
  return row ? { text: row.text, source: 'saved' } : { text: fileProfile(), source: 'default' };
}

export async function saveProfile(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text) throw new HttpError(400, 'The profile cannot be empty. Use Reset to default to go back to the built-in profile.');
  if (text.length > MAX_PROFILE_CHARS) throw new HttpError(400, `The profile is too long (${text.length.toLocaleString('en-US')} of ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters).`);
  const values = { id: 1, text, updatedAt: new Date() };
  await withRetry(() => getDb().insert(appProfile).values(values).onConflictDoUpdate({ target: appProfile.id, set: values }));
  await recordEvent({ category: 'settings', action: 'profile-saved', status: 'ok', details: { chars: text.length } }); // size only, never the text
}

export async function resetProfile(): Promise<void> {
  await withRetry(() => getDb().delete(appProfile).where(eq(appProfile.id, 1)));
  await recordEvent({ category: 'settings', action: 'profile-reset', status: 'ok' });
}
