import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyPassword } from './password';
import { checkLoginAllowed, recordLoginFailure } from './rate-limit';
import { createSession } from './session';

export type LoginResult = { ok: true; token: string } | { ok: false; error: string };

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export const clientIp = (h: Headers): string => h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip')?.trim() || 'unknown';

// The one fixed login. Wrong email and wrong password are indistinguishable (same message, both checks always run).
export async function attemptLogin({ email, password, ip }: { email: string; password: string; ip: string }): Promise<LoginResult> {
  const expectedEmail = process.env.APP_EMAIL;
  const hash = process.env.APP_PASSWORD_HASH;
  if (!expectedEmail || !hash) throw new Error('APP_EMAIL and APP_PASSWORD_HASH must be set');
  if (!email.trim() || !password) return { ok: false, error: 'Enter your email and password.' };
  if (!(await checkLoginAllowed(ip))) return { ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' };

  const emailOk = sameText(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const passwordOk = await verifyPassword(password, hash);
  if (!emailOk || !passwordOk) {
    await recordLoginFailure(ip);
    return { ok: false, error: 'Invalid email or password.' };
  }
  return { ok: true, token: await createSession(expectedEmail.trim().toLowerCase()) };
}
