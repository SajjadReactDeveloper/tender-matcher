import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, proxy } from '@/proxy';
import { SESSION_COOKIE, createSession } from '@/lib/auth/session';

beforeEach(() => vi.stubEnv('SESSION_SECRET', 'a'.repeat(40)));
afterEach(() => vi.unstubAllEnvs());

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

describe('proxy', () => {
  test('unauthenticated API call gets 401 JSON, not a redirect', async () => {
    const res = await proxy(req('/api/tenders'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not signed in' });
  });

  test('unauthenticated page request redirects to /login', async () => {
    const res = await proxy(req('/'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });

  test('a tampered or expired cookie is treated as signed out', async () => {
    const good = await createSession('me@example.com');
    expect((await proxy(req('/api/tenders', good.slice(0, -3) + 'abc'))).status).toBe(401);
    expect((await proxy(req('/api/tenders', await createSession('me@example.com', -5)))).status).toBe(401);
  });

  test('a valid session passes through with a nonce CSP and hardening headers', async () => {
    const res = await proxy(req('/api/tenders', await createSession('me@example.com')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  test('the login page is reachable signed out, and a signed-in user is sent to the dashboard', async () => {
    expect((await proxy(req('/login'))).status).toBe(200);
    const res = await proxy(req('/login', await createSession('me@example.com')));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });

  test('error responses from the proxy also carry the security headers', async () => {
    const res = await proxy(req('/api/tenders'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('proxy matcher', () => {
  const pattern = new RegExp('^' + config.matcher[0] + '$');

  test('does not intercept the Workflow runtime paths or static assets, but does cover pages and the API', () => {
    expect(pattern.test('/.well-known/workflow/v1/flow')).toBe(false);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/logo.svg')).toBe(false);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/api/runs')).toBe(true);
    expect(pattern.test('/login')).toBe(true);
  });
});
