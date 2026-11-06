import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanText, parseDetail, parseListing } from '@/sources/ppra/parse';
import { SourceShapeError } from '@/sources/types';
import { fetchBuffer } from '@/sources/http';

const fixture = (name: string) => readFileSync(`tests/fixtures/ppra/${name}`, 'utf8');

describe('parseListing', () => {
  test('reads 50 tenders with ids, ISO dates and the active total from a real listing page', () => {
    const { total, tenders } = parseListing(fixture('listing.html'));
    expect(tenders).toHaveLength(50);
    expect(total).toBeGreaterThan(1000);
    expect(tenders[0].externalId).toMatch(/^TS\d+E$/);
    expect(tenders[0].closing).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tenders[0].advertised).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tenders[0].title).not.toBe('');
    expect(tenders[0].url).toBe(`https://epms.ppra.gov.pk/public/tenders/tender-details/${tenders[0].externalId}`);
  });

  test('throws SourceShapeError when the page has no tender rows (site changed)', () => {
    expect(() => parseListing(fixture('empty.html'))).toThrowError(SourceShapeError);
    expect(() => parseListing(fixture('empty.html'))).toThrowError('source returned no tenders');
  });
});

describe('parseListing with drifted markup', () => {
  test('a row without a tender id (selectors drifted) fails loudly instead of storing blank ids', () => {
    const html = '<table class="cb-rt"><tbody><tr><td class="cb-rt-sr">1</td><td data-label="Tender Details"><strong>Some title</strong></td></tr></tbody></table>';
    expect(() => parseListing(html)).toThrowError(SourceShapeError);
    expect(() => parseListing(html)).toThrowError('tender id');
  });
});

describe('parseListing on a later page', () => {
  test('an empty page is the end of the listing when the caller expects it (a page after the first)', () => {
    expect(parseListing(fixture('empty.html'), { allowEmpty: true })).toEqual({ total: 0, tenders: [] });
  });
});

describe('parseDetail', () => {
  test('finds the tender document and advertisement links', () => {
    const d = parseDetail(fixture('detail.html'));
    expect(d.links.tenderDocument).toMatch(/^\/pdf\?file=/);
    expect(d.links.advertisement).toMatch(/^\/pdf\?file=/);
    expect(d.contactEmail).toBe('redacted@example.com');
  });
});

describe('cleanText', () => {
  test('decodes the double-encoded entities PPRA emits and collapses whitespace', () => {
    expect(cleanText('  Fruit &#38;  Veg &amp; Co\n ')).toBe('Fruit & Veg & Co');
  });
});

describe('fetchBuffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('rejects a download whose Content-Length exceeds 40 MB without reading it', async () => {
    vi.stubGlobal('fetch', async () => new Response('x', { headers: { 'content-length': String(50 * 1024 * 1024) } }));
    await expect(fetchBuffer('https://example.com/big.pdf', { retries: 0 })).rejects.toThrow(/too large/i);
  });

  test('retries a failed request and returns the body', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      if (++calls === 1) throw new Error('network down');
      return new Response('hello');
    });
    const buf = await fetchBuffer('https://example.com/a', { retries: 1, retryDelayMs: 0 });
    expect(buf.toString()).toBe('hello');
    expect(calls).toBe(2);
  });
});
