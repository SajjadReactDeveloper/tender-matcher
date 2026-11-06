import { listAiCalls, listAuditEvents } from '@/audit/store';
import { handle } from '@/lib/route';
import { rateLimit } from '@/lib/security';
import { parseFilter } from '../route';

// A cell that starts with = + - @ would run as a formula when the CSV is opened in Excel, so it is prefixed with an apostrophe.
const cell = (v: unknown): string => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const MAX_ROWS = 5000;

export const GET = (req: Request) =>
  handle(req, async () => {
    rateLimit('audit:export', 10);
    const { kind, ...filter } = parseFilter(req.url);
    const rows: Record<string, unknown>[] = [];
    let before = filter.before;
    while (rows.length < MAX_ROWS) {
      const page = kind === 'ai' ? await listAiCalls({ ...filter, before, limit: 200 }) : await listAuditEvents({ ...filter, before, limit: 200 });
      rows.push(...page.rows);
      if (!page.next) break;
      before = page.next;
    }
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-${kind}.csv"` } });
  });
