import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { run } from './pipeline.js';
import { load, tenderList, buildXlsx } from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const HTML = new URL('../public/index.html', import.meta.url);
const MAX_BODY = 1024;
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);

// Provider errors can echo key fragments: strip env secrets and key-shaped tokens before they reach the log or the UI.
const redact = (s) => {
  let out = String(s);
  for (const [k, v] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET/i.test(k) && v?.length >= 8) out = out.split(v).join('[redacted]');
  return out.replace(/\b(?:sk|gsk)[-_][\w-]{16,}/g, '[redacted]');
};

const job = { running: false, stop: false, log: [], startedAt: null, error: null };
const log = (m) => { m = redact(m); job.log.push(`${new Date().toLocaleTimeString()}  ${m}`); job.log = job.log.slice(-300); console.log(m); };

async function startRun(limit) {
  Object.assign(job, { running: true, stop: false, log: [], startedAt: Date.now(), error: null });
  try { await run({ limit, log, stopped: () => job.stop }); }
  catch (e) { job.error = redact(e.message); log(`ERROR: ${e.message}`); }
  job.running = false;
}

// Sliding-window rate limit, in memory. ponytail: per-process, fine for one local instance.
const hits = new Map();
const limited = (key, max, windowMs = 60000) => {
  const now = Date.now(), a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now); hits.set(key, a);
  return a.length > max;
};
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (now - a[a.length - 1] > 120000) hits.delete(k); }, 60000).unref();

const httpErr = (status, message) => Object.assign(new Error(message), { status });

const readJson = (req) => new Promise((ok, bad) => {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return bad(httpErr(415, 'Content-Type must be application/json'));
  let s = '', over = false;
  req.on('data', (d) => { if (over) return; s += d; if (s.length > MAX_BODY) { over = true; bad(httpErr(413, 'Request body too large')); } })
    .on('end', () => { if (over) return; try { ok(s ? JSON.parse(s) : {}); } catch { bad(httpErr(400, 'Invalid JSON')); } })
    .on('error', bad);
});

const headers = (nonce) => ({
  'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
});

const ROUTES = { '/': ['GET'], '/api/tenders': ['GET'], '/api/status': ['GET'], '/api/export.xlsx': ['GET'], '/api/run': ['POST'], '/api/stop': ['POST'] };

const server = http.createServer(async (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  const send = (code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { ...headers(nonce), 'Content-Type': type, ...extra }); res.end(body); };
  const fail = (code, message, extra) => send(code, JSON.stringify({ error: message }), undefined, extra);
  try {
    // DNS rebinding: only answer to our own loopback host names.
    if (!ALLOWED_HOSTS.has(req.headers.host)) return fail(403, 'Forbidden host');
    const ip = req.socket.remoteAddress;
    if (limited(`${ip}:all`, 300)) return fail(429, 'Too many requests. Wait a minute and try again.', { 'Retry-After': '60' });

    const { pathname } = new URL(req.url, 'http://x');
    const allowed = ROUTES[pathname];
    if (!allowed) return fail(404, 'Not found');
    if (!allowed.includes(req.method)) return fail(405, 'Method not allowed', { Allow: allowed.join(', ') });

    if (pathname !== '/') {
      // CORS: never granted. Browsers send Origin on cross-origin and POST requests, so reject anything not from our own page.
      const origin = req.headers.origin;
      if (origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return fail(403, 'Cross-origin requests are not allowed');
      const site = req.headers['sec-fetch-site'];
      if (site && !['same-origin', 'none'].includes(site)) return fail(403, 'Cross-origin requests are not allowed');
    }

    if (pathname === '/') return send(200, fs.readFileSync(HTML, 'utf8').replaceAll('<script>', `<script nonce="${nonce}">`), 'text/html; charset=utf-8');
    if (pathname === '/api/tenders') return send(200, JSON.stringify(tenderList(load())));
    if (pathname === '/api/status') {
      const s = load();
      return send(200, JSON.stringify({ ...job, matched: Object.keys(s.tenders).length, screened: Object.keys(s.seen).length, provider: process.env.AI_PROVIDER || 'groq' }));
    }
    if (pathname === '/api/run') {
      if (limited(`${ip}:run`, 5)) return fail(429, 'Too many run requests. Wait a minute and try again.', { 'Retry-After': '60' });
      const { limit = 150 } = await readJson(req);
      if (!Number.isFinite(Number(limit))) throw httpErr(400, '"limit" must be a number');
      if (job.running) throw httpErr(409, 'A run is already in progress');
      startRun(Math.min(Math.max(Math.trunc(Number(limit)) || 150, 1), 3000));
      return send(200, '{"ok":true}');
    }
    if (pathname === '/api/stop') { job.stop = true; return send(200, '{"ok":true}'); }
    if (pathname === '/api/export.xlsx') {
      if (limited(`${ip}:export`, 10)) return fail(429, 'Too many downloads. Wait a minute and try again.', { 'Retry-After': '60' });
      const buf = Buffer.from(await buildXlsx(load()));
      return send(200, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { 'Content-Disposition': 'attachment; filename="tenders.xlsx"' });
    }
  } catch (e) {
    if (e.status) return fail(e.status, e.message);
    console.error(redact(e.stack || e));
    if (!res.headersSent) fail(500, 'Internal server error');
  }
});

server.requestTimeout = 30000;
server.headersTimeout = 15000;
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', redact(e?.stack || e)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Dashboard running at ${url}`);
  if (process.platform === 'win32' && !process.env.NO_OPEN) execFile('cmd', ['/c', 'start', '', url]);
});
