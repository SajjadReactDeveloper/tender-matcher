import { HttpError } from '@/lib/security';
import { SESSION_COOKIE, verifySession } from './session';

// Second gate for route handlers. proxy.ts is the first, but the Next docs advise not to rely on it alone:
// a matcher mistake or a framework change must not silently open the API.
export async function requireSession(req: Request): Promise<{ email: string }> {
  const raw = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.get('cookie') ?? '')?.[1];
  let token: string | undefined;
  try {
    token = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    token = undefined;
  }
  const session = await verifySession(token);
  if (!session) throw new HttpError(401, 'Not signed in');
  return session;
}
