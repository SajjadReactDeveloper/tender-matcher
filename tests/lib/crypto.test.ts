import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decryptSecret, encryptSecret, encryptionConfigured } from '@/lib/crypto';
import { HttpError } from '@/lib/security';

const KEY = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => vi.stubEnv('SETTINGS_ENCRYPTION_KEY', KEY));
afterEach(() => vi.unstubAllEnvs());

describe('crypto', () => {
  test('round-trips a secret and never stores it in the clear', () => {
    const p = encryptSecret('gsk_supersecretvalue1234', 'groq');
    expect(JSON.stringify(p)).not.toContain('supersecret');
    expect(decryptSecret(p, 'groq')).toBe('gsk_supersecretvalue1234');
  });

  test('uses a fresh iv every time', () => {
    expect(encryptSecret('same-value-123', 'groq').iv).not.toBe(encryptSecret('same-value-123', 'groq').iv);
  });

  test('a tampered ciphertext, the wrong provider (aad) or the wrong key is rejected', () => {
    const p = encryptSecret('gsk_supersecretvalue1234', 'groq');
    const flipped = Buffer.from(p.ciphertext, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptSecret({ ...p, ciphertext: flipped.toString('base64') }, 'groq')).toThrow();
    expect(() => decryptSecret(p, 'openai')).toThrow();
    vi.stubEnv('SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    expect(() => decryptSecret(p, 'groq')).toThrow();
  });

  test('a missing or wrong-length key refuses to encrypt with a 503 and reports not configured', () => {
    for (const bad of ['', 'dG9vLXNob3J0']) {
      vi.stubEnv('SETTINGS_ENCRYPTION_KEY', bad);
      expect(encryptionConfigured()).toBe(false);
      const err = (() => { try { encryptSecret('x'.repeat(20), 'groq'); } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(503);
    }
  });
});
