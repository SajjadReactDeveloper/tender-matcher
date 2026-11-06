import * as cheerio from 'cheerio';
import { SourceShapeError, type ListedTender, type TenderDetail } from '../types';

export const PPRA_BASE = 'https://epms.ppra.gov.pk';

// The site double-encodes some entities (e.g. "&#38;"), so decode them once more.
export const cleanText = (s: string | undefined): string =>
  (s || '').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const toIso = (s: string): string => {
  const d = new Date(cleanText(s) + ' UTC');
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export function parseListing(html: string, { allowEmpty = false }: { allowEmpty?: boolean } = {}): { total: number; tenders: ListedTender[] } {
  const $ = cheerio.load(html);
  const total = Number(html.match(/of\s+([\d,]+)\s+tenders/)?.[1].replace(/,/g, '')) || 0;
  const tenders: ListedTender[] = [];
  $('table.cb-rt tbody tr').each((_, tr) => {
    const row = $(tr);
    if (!row.find('td.cb-rt-sr').length) return;
    const details = row.find('td[data-label="Tender Details"]');
    const grid: Record<string, ReturnType<typeof $>> = {};
    row.next().find('.cb-rt-grid > div').each((__, d) => {
      grid[cleanText($(d).find('.cb-rt-dl').text())] = $(d).find('.cb-rt-dv');
    });
    const org = grid['Organization'];
    const externalId = cleanText(row.find('.cb-rt-name').text());
    tenders.push({
      externalId,
      title: cleanText(details.find('strong').first().text()),
      note: cleanText(details.find('small.text-muted.d-block').eq(0).text()),
      description: cleanText(details.find('small.text-muted.d-block').eq(1).text()),
      sector: cleanText(details.find('.badge').eq(0).text()),
      refNo: cleanText(details.find('.badge').eq(1).text()),
      status: cleanText(row.find('td[data-label="Status"] .badge').first().text()),
      corrigendum: /Corrigendum/i.test(row.find('td[data-label="Status"]').text()),
      advertised: toIso(row.find('td[data-label="Advertised"]').text()),
      closing: toIso(row.find('td[data-label="Closing"] strong').text()),
      closingTime: cleanText(row.find('td[data-label="Closing"] small').text()),
      organization: cleanText(org?.find('strong').first().text()),
      office: cleanText(org?.find('span.d-block').first().text()),
      location: cleanText(org?.find('small').first().text()),
      type: cleanText(grid['Tender Type']?.text()),
      category: cleanText(grid['Procurement Category']?.text()),
      nature: cleanText(grid['Tender Nature']?.text()),
      url: `${PPRA_BASE}/public/tenders/tender-details/${externalId}`,
    });
  });
  // An empty first page means the site changed; an empty later page just means the listing shrank while we were reading it.
  if (!tenders.length && !allowEmpty) throw new SourceShapeError('source returned no tenders');
  return { total, tenders };
}

export function parseDetail(html: string): TenderDetail {
  const $ = cheerio.load(html);
  const lines = $('body').text().split('\n').map(cleanText).filter(Boolean);
  const field = (label: string): string => {
    const i = lines.findIndex((l) => l === label || l === label + ':');
    return i >= 0 ? (lines[i + 1] ?? '') : '';
  };
  const links: TenderDetail['links'] = {};
  $('a[href^="/pdf?file="]').each((_, a) => {
    links[/advert/i.test($(a).text()) ? 'advertisement' : 'tenderDocument'] = $(a).attr('href');
  });
  return {
    contactPerson: field('Contact Person'),
    contactEmail: field('Contact Email'),
    contactPhone: field('Contact Phone'),
    procedure: field('Procurement Procedure'),
    bidSecurity: field('Bid Security'),
    bidValidity: field('Bid Validity'),
    links,
  };
}
