import { afterEach, describe, expect, test, vi } from 'vitest';
import { redact } from '@/lib/security';

afterEach(() => vi.unstubAllEnvs());

describe('redact', () => {
  test('removes values of secret-looking env vars', () => {
    vi.stubEnv('GROQ_API_KEY', 'abcdef-supersecret-123');
    expect(redact('Incorrect key abcdef-supersecret-123 provided')).toBe('Incorrect key [redacted] provided');
  });

  test('removes sk- and gsk_ shaped tokens even when not in the env', () => {
    expect(redact('bad sk-proj_ABCDEFGHIJKLMNOP1234 and gsk_ABCDEFGHIJKLMNOP1234')).toBe('bad [redacted] and [redacted]');
  });

  test('leaves ordinary text alone', () => {
    expect(redact('Tender TS0000017278E closes tomorrow')).toBe('Tender TS0000017278E closes tomorrow');
  });
});
