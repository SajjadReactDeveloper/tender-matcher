import { vi } from 'vitest';
import { SESSION_COOKIE, createSession } from '@/lib/auth/session';

// A valid signed-in Cookie header for route-handler tests (the handlers check the session themselves, not only the proxy).
export async function signedIn(): Promise<{ cookie: string }> {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
  return { cookie: `${SESSION_COOKIE}=${await createSession('me@example.com')}` };
}
