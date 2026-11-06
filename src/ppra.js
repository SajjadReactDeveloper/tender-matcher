import * as cheerio from 'cheerio';

const BASE = 'https://epms.ppra.gov.pk';
const MAX_BYTES = 40 * 1024 * 1024;
const UA ={ 'User-Agent': 'Mozilla/5.0 (compatible; tender-matcher; internal use)' };

const get = async (path, binary = false) => {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(BASE + path, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`PPRA ${res.status} for ${path}`);
      if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error(`PPRA file too large for ${path}`);
      const buf = Buffer.from(await res.arrayBuffer()); // ponytail: no streaming cap, chunked responses are checked after download
      if (buf.length > MAX_BYTES) throw new Error(`PPRA file too large for ${path}`);
      return binary ? buf : buf.toString('utf8');
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
};

// The site double-encodes some entities (e.g. "&#38;"), so decode them once more.
const clean = (s) => (s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const iso = (s) => { const d = new Date(clean(s) + ' UTC'); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };

// One listing page -> { total, tenders: [...] }
export async function fetchListing(page = 1) {
  const html = await get(`/public/tenders/active-tenders?page=${page}`);
  const $ = cheerio.load(html);
  const total = Number(html.match(/of\s+([\d,]+)\s+tenders/)?.[1].replace(/,/g, '')) || 0;
  const tenders = [];
  $('table.cb-rt tbody tr').each((_, tr) => {
    const row = $(tr);
    if (!row.find('td.cb-rt-sr').length) return;
    const details = row.find('td[data-label="Tender Details"]');
    const grid = {};
    row.next().find('.cb-rt-grid > div').each((__, d) => {
      grid[clean($(d).find('.cb-rt-dl').text())] = $(d).find('.cb-rt-dv');
    });
    const org = grid['Organization'];
    tenders.push({
      id: clean(row.find('.cb-rt-name').text()),
      title: clean(details.find('strong').first().text()),
      note: clean(details.find('small.text-muted.d-block').eq(0).text()),
      description: clean(details.find('small.text-muted.d-block').eq(1).text()),
      sector: clean(details.find('.badge').eq(0).text()),
      refNo: clean(details.find('.badge').eq(1).text()),
      status: clean(row.find('td[data-label="Status"] .badge').first().text()),
      corrigendum: /Corrigendum/i.test(row.find('td[data-label="Status"]').text()),
      advertised: iso(row.find('td[data-label="Advertised"]').text()),
      closing: iso(row.find('td[data-label="Closing"] strong').text()),
      closingTime: clean(row.find('td[data-label="Closing"] small').text()),
      organization: clean(org?.find('strong').first().text()),
      office: clean(org?.find('span.d-block').first().text()),
      location: clean(org?.find('small').first().text()),
      type: clean(grid['Tender Type']?.text()),
      category: clean(grid['Procurement Category']?.text()),
      nature: clean(grid['Tender Nature']?.text()),
      url: `${BASE}/public/tenders/tender-details/${clean(row.find('.cb-rt-name').text())}`,
    });
  });
  return { total, tenders };
}

// Detail page -> contact, money, procedure and PDF links.
export async function fetchDetail(id) {
  const html = await get(`/public/tenders/tender-details/${id}`);
  const $ = cheerio.load(html);
  const lines = $('body').text().split('\n').map(clean).filter(Boolean);
  const field = (label) => {
    const i = lines.findIndex((l) => l === label || l === label + ':');
    return i >= 0 ? lines[i + 1] : '';
  };
  const links = {};
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
    openingTime: field('Opening Time'),
    corrigenda: Number(html.match(/Corrigendum History \((\d+)\)/)?.[1] || 0),
    links,
  };
}

export const fetchPdf = (href) => get(href, true);
