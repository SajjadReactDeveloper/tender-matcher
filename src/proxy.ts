import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { securityHeaders } from '@/lib/security';

// Runs on every request: signs out anything without a valid session cookie, and stamps the CSP nonce and security headers.
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const headers = securityHeaders(nonce);
  const stamp = (res: NextResponse): NextResponse => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };

  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = pathname === '/login';

  if (!session && !isLogin) {
    if (pathname.startsWith('/api/')) return stamp(NextResponse.json({ error: 'Not signed in' }, { status: 401 }));
    return stamp(NextResponse.redirect(new URL('/login', req.url)));
  }
  if (session && isLogin) return stamp(NextResponse.redirect(new URL('/', req.url)));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy']);
  return stamp(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
