import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { loginAttempts } from '@/db/schema';
import type { Db } from '@/db/client';
import { attemptLogin, clientIp } from '@/lib/auth/login';
import { releaseLoginAttempt, reserveLoginAttempt } from '@/lib/auth/rate-limit';
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
  test('allows 5 attempts per ip in 15 minutes, blocks the 6th, and leaves other ips alone', async () => {
    for (let i = 0; i < 5; i++) expect((await reserveLoginAttempt('1.1.1.1')).allowed).toBe(true);
    expect((await reserveLoginAttempt('1.1.1.1')).allowed).toBe(false);
    expect((await reserveLoginAttempt('2.2.2.2')).allowed).toBe(true);
  });

  test('attempts older than 15 minutes no longer count', async () => {
    for (let i = 0; i < 5; i++) await db.insert(loginAttempts).values({ ip: '3.3.3.3', at: sql`now() - interval '16 minutes'` });
    expect((await reserveLoginAttempt('3.3.3.3')).allowed).toBe(true);
  });

  test('a global cap of 20 attempts in 15 minutes blocks everyone, so rotating ips does not help', async () => {
    for (let i = 0; i < 20; i++) expect((await reserveLoginAttempt(`10.0.0.${i}`)).allowed).toBe(true);
    expect((await reserveLoginAttempt('10.9.9.9')).allowed).toBe(false);
  });

  test('concurrent attempts cannot exceed the limit (reserve before deciding)', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveLoginAttempt('4.4.4.4')));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  test('releasing a reservation removes only that attempt', async () => {
    const a = await reserveLoginAttempt('5.5.5.5');
    await reserveLoginAttempt('5.5.5.5');
    await releaseLoginAttempt(a.id);
    expect(await db.select().from(loginAttempts)).toHaveLength(1);
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

  test('successful logins release their reservation, so they never use up the allowance', async () => {
    for (let i = 0; i < 8; i++) expect((await attemptLogin({ email: 'me@example.com', password: 'right-password', ip: '9.1.1.1' })).ok).toBe(true);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  test('empty fields are rejected without touching the rate limit table', async () => {
    const r = await attemptLogin({ email: '', password: '', ip: '7.7.7.7' });
    expect(r.ok).toBe(false);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });
});

describe('clientIp', () => {
  test('prefers the platform header, then x-real-ip, then the rightmost x-forwarded-for entry', () => {
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '7.7.7.7', 'x-forwarded-for': '1.2.3.4' }))).toBe('7.7.7.7');
    expect(clientIp(new Headers({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '1.2.3.4' }))).toBe('6.6.6.6');
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.5.5.5' }))).toBe('5.5.5.5');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
