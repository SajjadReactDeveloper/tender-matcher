import { beforeEach, describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { tenders } from '@/db/schema';
import type { Db } from '@/db/client';
import { GET as getTenders } from '@/app/api/tenders/route';
import { createTestDb } from '../helpers/test-db';
import { signedIn } from '../helpers/auth';

let db: Db;
let auth = {} as { cookie: string };
beforeEach(async () => {
  auth = await signedIn();
  db = await createTestDb();
});

const base = { title: 'T', decision: 'matched' as const, relevance: 'High' as const, score: 80, recommendation: 'Bid - fits', challenges: 'c', scope: 's' };
const seed = () =>
  db.insert(tenders).values([
    { ...base, source: 'ppra', externalId: 'A', title: 'Older', postingDate: '2026-11-01', closingDate: '2026-11-20', organization: 'Org A', url: 'https://x/A', refNo: 'R-A', docTender: '/pdf?file=t', pagesRead: 3 },
    { ...base, source: 'ppra', externalId: 'B', title: 'Newer', postingDate: '2026-11-05', closingDate: '2026-11-25', organization: 'Org B', url: 'https://x/B', refNo: 'R-B' },
    { ...base, source: 'other', externalId: 'C', title: 'Other source', postingDate: '2026-11-03', closingDate: '2026-11-22' },
    { source: 'ppra', externalId: 'D', title: 'Pending one', decision: 'pending', postingDate: '2026-11-06' },
    { source: 'ppra', externalId: 'E', title: 'Candidate one', decision: 'candidate', postingDate: '2026-11-06' },
    { source: 'ppra', externalId: 'F', title: 'Skipped one', decision: 'skipped', postingDate: '2026-11-06' },
  ]);

describe('GET /api/tenders', () => {
  test('returns only matched tenders, newest posting date first, in the dashboard shape', async () => {
    await seed();
    const body = await (await getTenders(new Request('http://localhost:3000/api/tenders', { headers: auth }))).json();
    expect(body.map((t: { name: string }) => t.name)).toEqual(['Newer', 'Other source', 'Older']);
    expect(body[2]).toMatchObject({
      source: 'ppra', name: 'Older', department: 'Org A', postingDate: '2026-11-01', lastDate: '2026-11-20', refNo: 'R-A', url: 'https://x/A',
      relevance: 'High', score: 80, recommendation: 'Bid - fits', docs: { tender: 'https://epms.ppra.gov.pk/pdf?file=t', pagesRead: 3 },
    });
  });

  test('?source= limits the list to one source', async () => {
    await seed();
    const body = await (await getTenders(new Request('http://localhost:3000/api/tenders?source=other', { headers: auth }))).json();
    expect(body.map((t: { name: string }) => t.name)).toEqual(['Other source']);
  });

  test('is an empty array when nothing has matched yet', async () => {
    expect(await (await getTenders(new Request('http://localhost:3000/api/tenders', { headers: auth }))).json()).toEqual([]);
  });
});

describe('GET /api/export', () => {
  const load = async (res: Response) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    return wb.getWorksheet('Tenders')!;
  };
  const route = async () => {
    const { vi } = await import('vitest');
    vi.resetModules(); // fresh in-memory rate limiter per test
    (await import('@/db/client')).setDb(db); // the fresh module graph needs the test database too
    return import('@/app/api/export/route');
  };

  test('downloads an xlsx with the eleven team columns and one row per matched tender', async () => {
    await seed();
    const { GET } = await route();
    const res = await GET(new Request('http://localhost:3000/api/export', { headers: { host: 'localhost:3000', ...auth } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="tenders.xlsx"');
    const ws = await load(res);
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Posting Date', 'Last Date', 'Department', 'Tender Name', 'Relevance', 'Technical evaluation score', 'recommendations',
      'Dependencies / challenges', 'brief scope 200 words', 'Tender No', 'PPRA Link',
    ]);
    expect(ws.rowCount).toBe(4); // header + 3 matched
    expect(ws.getRow(2).getCell(4).value).toBe('Newer');
  });

  test('text that looks like a formula is stored as plain text, not executed by Excel', async () => {
    await db.insert(tenders).values({ ...base, source: 'ppra', externalId: 'X', title: '=HYPERLINK("http://evil","click")', postingDate: '2026-11-05' });
    const { GET } = await route();
    const ws = await load(await GET(new Request('http://localhost:3000/api/export', { headers: { host: 'localhost:3000', ...auth } })));
    const cell = ws.getRow(2).getCell(4);
    expect(typeof cell.value).toBe('string');
    expect(cell.value).toBe('=HYPERLINK("http://evil","click")');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
  });

  test('the 11th download within a minute is rate limited', async () => {
    const { GET } = await route();
    const req = () => new Request('http://localhost:3000/api/export', { headers: { host: 'localhost:3000', ...auth } });
    for (let i = 0; i < 10; i++) expect((await GET(req())).status).toBe(200);
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  test('rejects a cross-origin export request', async () => {
    const { GET } = await route();
    const res = await GET(new Request('http://localhost:3000/api/export', { headers: { host: 'localhost:3000', origin: 'https://evil.com', ...auth } }));
    expect(res.status).toBe(403);
  });
});
