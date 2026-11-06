import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSession, verifySession } from '@/lib/auth/session';

beforeEach(() => vi.stubEnv('SESSION_SECRET', 'a'.repeat(40)));
afterEach(() => vi.unstubAllEnvs());

describe('session cookie', () => {
  test('round-trips the email', async () => {
    const token = await createSession('me@example.com');
    expect(await verifySession(token)).toEqual({ email: 'me@example.com' });
  });

  test('returns null for undefined, garbage and tampered tokens', async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession('not.a.jwt')).toBeNull();
    const token = await createSession('me@example.com');
    const [h, p, s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ email: 'evil@example.com', exp: 9999999999 })).toString('base64url')}.${s}`;
    expect(await verifySession(forged)).toBeNull();
    expect(await verifySession(`${h}.${p}.${s.slice(0, -2)}xx`)).toBeNull();
  });

  test('returns null for an expired token', async () => {
    expect(await verifySession(await createSession('me@example.com', -10))).toBeNull();
  });

  test('a token signed with another secret is rejected', async () => {
    const token = await createSession('me@example.com');
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(40));
    expect(await verifySession(token)).toBeNull();
  });

  test('refuses to run with a short SESSION_SECRET', async () => {
    vi.stubEnv('SESSION_SECRET', 'short');
    await expect(createSession('me@example.com')).rejects.toThrow(/SESSION_SECRET/);
  });
});
