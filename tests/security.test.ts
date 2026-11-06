import { afterEach, describe, expect, test, vi } from 'vitest';
import { HttpError, assertSameOrigin, errorResponse, rateLimit, readJsonBody, securityHeaders } from '@/lib/security';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://app.example.com/api/runs', { method: 'POST', body, headers: { host: 'app.example.com', ...headers } });

afterEach(() => vi.restoreAllMocks());

describe('assertSameOrigin', () => {
  test('allows a missing Origin (curl, server-to-server) and a matching one', () => {
    expect(() => assertSameOrigin(post('{}'))).not.toThrow();
    expect(() => assertSameOrigin(post('{}', { origin: 'https://app.example.com' }))).not.toThrow();
  });

  test('rejects a foreign Origin with 403', () => {
    const run = () => assertSameOrigin(post('{}', { origin: 'https://evil.com' }));
    expect(run).toThrowError(HttpError);
    expect(run).toThrowError('Cross-origin requests are not allowed');
  });

  test('rejects Sec-Fetch-Site cross-site and same-site, allows same-origin and none', () => {
    expect(() => assertSameOrigin(post('{}', { 'sec-fetch-site': 'cross-site' }))).toThrowError(HttpError);
    expect(() => assertSameOrigin(post('{}', { 'sec-fetch-site': 'same-site' }))).toThrowError(HttpError);
    expect(() => assertSameOrigin(post('{}', { 'sec-fetch-site': 'same-origin' }))).not.toThrow();
    expect(() => assertSameOrigin(post('{}', { 'sec-fetch-site': 'none' }))).not.toThrow();
  });
});

describe('readJsonBody', () => {
  const json = { 'content-type': 'application/json' };

  test('parses a small JSON body and treats an empty body as {}', async () => {
    expect(await readJsonBody(post('{"limit":5}', json))).toEqual({ limit: 5 });
    expect(await readJsonBody(post('', json))).toEqual({});
  });

  test('rejects a 2 KB body with 413', async () => {
    await expect(readJsonBody(post(JSON.stringify({ x: 'a'.repeat(2048) }), json))).rejects.toMatchObject({ status: 413 });
  });

  test('rejects a non-JSON content type with 415', async () => {
    await expect(readJsonBody(post('{}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({ status: 415 });
    await expect(readJsonBody(post('{}'))).rejects.toMatchObject({ status: 415 });
  });

  test('rejects invalid JSON with 400', async () => {
    await expect(readJsonBody(post('{bad', json))).rejects.toMatchObject({ status: 400 });
  });
});

describe('securityHeaders', () => {
  const h = securityHeaders('abc123', false);

  test('CSP carries the nonce, forbids framing and objects, and does not allow unsafe-eval in production', () => {
    expect(h['Content-Security-Policy']).toContain("'nonce-abc123'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Content-Security-Policy']).toContain("object-src 'none'");
    expect(h['Content-Security-Policy']).not.toContain('unsafe-eval');
    expect(securityHeaders('abc123', true)['Content-Security-Policy']).toContain("'unsafe-eval'");
  });

  test('sets the standard hardening headers and never sends CORS headers', () => {
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(Object.keys(h).some((k) => k.toLowerCase().startsWith('access-control-'))).toBe(false);
  });
});

describe('errorResponse', () => {
  test('returns an HttpError as its status and message', async () => {
    const res = errorResponse(new HttpError(409, 'A run is already in progress'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A run is already in progress' });
  });

  test('hides internal errors behind a generic 500 and logs the redacted detail', async () => {
    vi.stubEnv('GROQ_API_KEY', 'super-secret-key-value');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('db exploded using super-secret-key-value'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    expect(String(log.mock.calls[0]?.[0])).not.toContain('super-secret-key-value');
    vi.unstubAllEnvs();
  });

  test('includes Retry-After for rate limit errors', () => {
    expect(errorResponse(new HttpError(429, 'slow', { 'Retry-After': '60' })).headers.get('Retry-After')).toBe('60');
  });
});

describe('rateLimit', () => {
  test('throws 429 with Retry-After once the limit in the window is exceeded, per key', () => {
    for (let i = 0; i < 3; i++) rateLimit('k1', 3);
    expect(() => rateLimit('k1', 3)).toThrowError(HttpError);
    try {
      rateLimit('k1', 3);
    } catch (e) {
      expect((e as HttpError).status).toBe(429);
      expect((e as HttpError).headers['Retry-After']).toBeDefined();
    }
    expect(() => rateLimit('k2', 3)).not.toThrow();
  });
});
