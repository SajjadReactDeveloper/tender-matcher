import { describe, expect, test } from 'vitest';
import { getEnv } from '@/lib/env';

const valid = {
  DATABASE_URL: 'postgres://u:p@host/db?sslmode=require',
  SESSION_SECRET: 'a'.repeat(32),
  APP_EMAIL: 'me@example.com',
  APP_PASSWORD_HASH: 'scrypt$16384$salt$hash',
};

describe('getEnv', () => {
  test('names every missing variable but never prints values', () => {
    expect(() => getEnv({ DATABASE_URL: 'not-a-url-xX-leak-xX' })).toThrowError(/DATABASE_URL/);
    try {
      getEnv({ DATABASE_URL: 'not-a-url-xX-leak-xX' });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('SESSION_SECRET');
      expect(msg).toContain('APP_EMAIL');
      expect(msg).not.toContain('xX-leak-xX');
    }
  });

  test('rejects a SESSION_SECRET shorter than 32 characters', () => {
    expect(() => getEnv({ ...valid, SESSION_SECRET: 'too-short' })).toThrowError(/SESSION_SECRET/);
  });

  test('defaults AI_PROVIDER to groq and rejects unknown providers', () => {
    expect(getEnv(valid).AI_PROVIDER).toBe('groq');
    expect(() => getEnv({ ...valid, AI_PROVIDER: 'bogus' })).toThrowError(/AI_PROVIDER/);
  });
});
