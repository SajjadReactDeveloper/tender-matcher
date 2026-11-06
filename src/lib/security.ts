// Provider errors can echo key fragments: strip env secrets and key-shaped tokens before anything is logged or shown.
export function redact(input: string): string {
  let out = String(input);
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DIRECT_URL/i.test(name) && value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out.replace(/\b(?:sk|gsk)[-_][\w-]{16,}/g, '[redacted]');
}

export class HttpError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

// Nonce CSP plus the standard hardening headers. Deliberately no Access-Control-* headers: CORS is never granted.
export function securityHeaders(nonce: string, dev = process.env.NODE_ENV === 'development'): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", // inline style attributes are used for score rings and chart positions
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}

// CSRF defence for state-changing routes: browsers always send Origin on cross-origin and POST requests.
export function assertSameOrigin(req: Request): void {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const origin = req.headers.get('origin');
  let originHost: string | null = null;
  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = 'invalid';
    }
  }
  const site = req.headers.get('sec-fetch-site');
  if ((originHost && originHost !== host) || (site && site !== 'same-origin' && site !== 'none')) {
    throw new HttpError(403, 'Cross-origin requests are not allowed');
  }
}

export async function readJsonBody(req: Request, maxBytes = 1024): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) throw new HttpError(415, 'Content-Type must be application/json');
  if (Number(req.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'Request body too large');
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers: e.headers });
  console.error(redact(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

// Sliding window per key. ponytail: in memory, so per server instance; login limiting is the DB-backed one. Move to a table if abuse appears.
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs = 60_000): void {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
  if (recent.length > max) throw new HttpError(429, 'Too many requests. Wait a minute and try again.', { 'Retry-After': String(Math.ceil(windowMs / 1000)) });
}
