import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'tm_session';
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // seconds

const secret = (): Uint8Array => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
};

export async function createSession(email: string, ttlSeconds = SESSION_MAX_AGE): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<{ email: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return typeof payload.email === 'string' ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

// Strict + HttpOnly + Secure: the cookie is never sent cross-site and scripts cannot read it.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE,
};
