import { createHash, timingSafeEqual } from 'node:crypto';
import { recordEvent } from '@/audit/store';
import { verifyPassword } from './password';
import { releaseLoginAttempt, reserveLoginAttempt } from './rate-limit';
import { createSession, verifySession } from './session';

export type LoginResult = { ok: true; token: string } | { ok: false; error: string };

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

// Client address for rate limiting. x-forwarded-for is client-controlled on its left side, so we never take its first entry:
// prefer the header the platform sets itself, then x-real-ip, then the entry our nearest proxy appended (rightmost).
export const clientIp = (h: Headers): string => {
  const xff = h.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
  return h.get('x-vercel-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')?.trim() || xff?.[xff.length - 1] || 'unknown';
};

// The one fixed login. Wrong email and wrong password are indistinguishable (same message, both checks always run).
export async function attemptLogin({ email, password, ip, userAgent }: { email: string; password: string; ip: string; userAgent?: string }): Promise<LoginResult> {
  const expectedEmail = process.env.APP_EMAIL;
  const hash = process.env.APP_PASSWORD_HASH;
  if (!expectedEmail || !hash) throw new Error('APP_EMAIL and APP_PASSWORD_HASH must be set');
  if (!email.trim() || !password) return { ok: false, error: 'Enter your email and password.' };

  const attempt = await reserveLoginAttempt(ip);
  if (!attempt.allowed) {
    // blocked attempts are not audited: anyone can send them, so recording each would let a flood fill the table
    return { ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' };
  }

  const emailOk = sameText(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const passwordOk = await verifyPassword(password, hash);
  if (!emailOk || !passwordOk) {
    await recordEvent({ category: 'auth', action: 'login-failed', status: 'error', details: { ip, userAgent, emailMatched: emailOk } }); // never the typed email or password
    return { ok: false, error: 'Invalid email or password.' };
  }

  await releaseLoginAttempt(attempt.id);
  await recordEvent({ category: 'auth', action: 'login-ok', status: 'ok', details: { ip, userAgent } });
  return { ok: true, token: await createSession(expectedEmail.trim().toLowerCase()) };
}

// Only a request with a valid session is recorded as a logout, so visitors without one cannot add audit rows.
export async function recordLogout(token: string | undefined, ip: string): Promise<void> {
  if (!(await verifySession(token))) return;
  await recordEvent({ category: 'auth', action: 'logout', status: 'info', details: { ip } });
}
