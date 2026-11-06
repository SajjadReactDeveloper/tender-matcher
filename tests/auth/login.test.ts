import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { loginAttempts } from '@/db/schema';
import type { Db } from '@/db/client';
import { attemptLogin, clientIp } from '@/lib/auth/login';
import { checkLoginAllowed, recordLoginFailure } from '@/lib/auth/rate-limit';
import { hashPassword } from '@/lib/auth/password';
import { verifySession } from '@/lib/auth/session';
import { createTestDb } from '../helpers/test-db';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
  vi.stubEnv('APP_EMAIL', 'me@example.com');
  vi.stubEnv('APP_PASSWORD_HASH', await hashPassword('right-password'));
});
afterEach(() => vi.unstubAllEnvs());

describe('rate limiting', () => {
  test('blocks an ip after 5 failures in 15 minutes but not other ips', async () => {
    for (let i = 0; i < 4; i++) await recordLoginFailure('1.1.1.1');
    expect(await checkLoginAllowed('1.1.1.1')).toBe(true);
    await recordLoginFailure('1.1.1.1');
    expect(await checkLoginAllowed('1.1.1.1')).toBe(false);
    expect(await checkLoginAllowed('2.2.2.2')).toBe(true);
  });

  test('failures older than 15 minutes no longer count', async () => {
    for (let i = 0; i < 5; i++) await db.insert(loginAttempts).values({ ip: '3.3.3.3', at: sql`now() - interval '16 minutes'` });
    expect(await checkLoginAllowed('3.3.3.3')).toBe(true);
  });
});

describe('attemptLogin', () => {
  test('correct credentials return a session token for the configured email', async () => {
    const r = await attemptLogin({ email: 'me@example.com', password: 'right-password', ip: '9.9.9.9' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(await verifySession(r.token)).toEqual({ email: 'me@example.com' });
  });

  test('wrong email and wrong password give the identical error message', async () => {
    const a = await attemptLogin({ email: 'other@example.com', password: 'right-password', ip: '9.9.9.1' });
    const b = await attemptLogin({ email: 'me@example.com', password: 'nope', ip: '9.9.9.2' });
    expect(a).toEqual({ ok: false, error: 'Invalid email or password.' });
    expect(b).toEqual(a);
  });

  test('email matching ignores case and surrounding spaces', async () => {
    const r = await attemptLogin({ email: '  ME@Example.com ', password: 'right-password', ip: '9.9.9.3' });
    expect(r.ok).toBe(true);
  });

  test('after 5 failures even the correct password is refused until the window passes', async () => {
    for (let i = 0; i < 5; i++) await attemptLogin({ email: 'me@example.com', password: 'bad', ip: '8.8.8.8' });
    const r = await attemptLogin({ email: 'me@example.com', password: 'right-password', ip: '8.8.8.8' });
    expect(r).toEqual({ ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' });
  });

  test('empty fields are rejected without touching the rate limit table', async () => {
    const r = await attemptLogin({ email: '', password: '', ip: '7.7.7.7' });
    expect(r.ok).toBe(false);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });
});

describe('clientIp', () => {
  test('uses the first x-forwarded-for entry, then x-real-ip, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }))).toBe('5.5.5.5');
    expect(clientIp(new Headers({ 'x-real-ip': '6.6.6.6' }))).toBe('6.6.6.6');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
