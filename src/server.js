import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { run } from './pipeline.js';
import { load, tenderList, buildXlsx } from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const job = { running: false, stop: false, log: [], startedAt: null, error: null };
const log = (m) => { job.log.push(`${new Date().toLocaleTimeString()}  ${m}`); job.log = job.log.slice(-300); console.log(m); };

async function startRun(limit) {
  if (job.running) return;
  Object.assign(job, { running: true, stop: false, log: [], startedAt: Date.now(), error: null });
  try { await run({ limit, log, stopped: () => job.stop }); }
  catch (e) { job.error = e.message; log(`ERROR: ${e.message}`); }
  job.running = false;
}

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (d) => (s += d)).on('end', () => r(s)); });

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname === '/') return send(res, 200, fs.readFileSync('public/index.html'), 'text/html; charset=utf-8');
    if (pathname === '/api/tenders') return send(res, 200, JSON.stringify(tenderList(load())));
    if (pathname === '/api/status') {
      const s = load();
      return send(res, 200, JSON.stringify({ ...job, matched: Object.keys(s.tenders).length, screened: Object.keys(s.seen).length, provider: process.env.AI_PROVIDER || 'groq' }));
    }
    if (pathname === '/api/run' && req.method === 'POST') {
      const { limit } = JSON.parse((await readBody(req)) || '{}');
      startRun(Math.min(Math.max(Number(limit) || 150, 1), 3000));
      return send(res, 200, '{"ok":true}');
    }
    if (pathname === '/api/stop' && req.method === 'POST') { job.stop = true; return send(res, 200, '{"ok":true}'); }
    if (pathname === '/api/export.xlsx') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="tenders.xlsx"' });
      return res.end(Buffer.from(await buildXlsx(load())));
    }
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) { send(res, 500, JSON.stringify({ error: e.message })); }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Dashboard running at ${url}`);
  if (process.platform === 'win32' && !process.env.NO_OPEN) execFile('cmd', ['/c', 'start', '', url]);
});
