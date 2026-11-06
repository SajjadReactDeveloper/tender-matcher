import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { listAuditEvents } from '@/audit/store';
import { defaultDeps } from '@/jobs/pipeline';
import { MAX_PROFILE_CHARS, getProfile, resetProfile, saveProfile } from '@/settings/profile';
import { createTestDb } from '../helpers/test-db';

const FILE = readFileSync('config/profile.md', 'utf8');

beforeEach(async () => {
  await createTestDb();
});

describe('company profile', () => {
  test('with nothing saved it falls back to the profile file shipped with the app', async () => {
    expect(await getProfile()).toEqual({ text: FILE, source: 'default' });
  });

  test('a saved profile replaces the file, is trimmed, and is what the pipeline reads', async () => {
    await saveProfile('  We build mobile apps.  \n');
    expect(await getProfile()).toEqual({ text: 'We build mobile apps.', source: 'saved' });
    expect(await defaultDeps().profile()).toBe('We build mobile apps.');
  });

  test('reset goes back to the file', async () => {
    await saveProfile('Temporary text');
    await resetProfile();
    expect((await getProfile()).source).toBe('default');
    expect(await defaultDeps().profile()).toBe(FILE);
  });

  test('empty, whitespace-only and oversized profiles are refused with 400 and nothing is stored', async () => {
    await expect(saveProfile('   ')).rejects.toMatchObject({ status: 400 });
    await expect(saveProfile('x'.repeat(MAX_PROFILE_CHARS + 1))).rejects.toMatchObject({ status: 400 });
    expect((await getProfile()).source).toBe('default');
  });

  test('changes are audited with their size but never the text itself', async () => {
    await saveProfile('Secret company details that must not be logged');
    await resetProfile();
    const rows = (await listAuditEvents({ category: 'settings' })).rows.reverse();
    expect(rows.map((r) => r.action)).toEqual(['profile-saved', 'profile-reset']);
    expect(rows[0].details).toMatchObject({ chars: 46 });
    expect(JSON.stringify(rows)).not.toContain('Secret company');
  });
});
