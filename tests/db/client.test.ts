import { afterEach, describe, expect, test, vi } from 'vitest';
import { getDb, setDb } from '@/db/client';

afterEach(() => {
  setDb(undefined);
  vi.unstubAllEnvs();
});

describe('getDb', () => {
  test('needs only DATABASE_URL: unrelated missing variables (such as the login credentials) do not break it', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@localhost/db');
    vi.stubEnv('APP_EMAIL', '');
    vi.stubEnv('APP_PASSWORD_HASH', '');
    expect(() => getDb()).not.toThrow();
  });

  test('names DATABASE_URL when it is missing, without printing any value', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => getDb()).toThrowError('DATABASE_URL is not set');
  });
});
