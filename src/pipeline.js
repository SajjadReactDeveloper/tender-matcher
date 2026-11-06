import fs from 'node:fs';
import { chat } from './llm.js';
import { fetchListing, fetchDetail, fetchPdf } from './ppra.js';
import { readPdf } from './pdf.js';
import { load, save, writeXlsx } from './store.js';

const MAX_DOC_PAGES = Number(process.env.MAX_DOC_PAGES) || 4; // tender-document pages read per tender (plus 1 advertisement page): each page costs ~2k vision tokens, and Groq's free tier allows 200k a day
const TRIAGE_BATCH = 20;
const profile = () => fs.readFileSync('config/profile.md', 'utf8');

async function triage(batch) {
  const items = batch.map(({ id, title, note, description, sector, category, organization, type }) =>
    ({ id, title, note, description, sector, category, organization, type }));
  const r = await chat({
    json: true,
    system: `You screen government tenders for a company. Company profile:\n${profile()}\n\nFor each tender decide if it could plausibly be a match for the company. If unsure, say relevant. Reply ONLY with JSON: {"results":[{"id":"...","relevant":true|false,"reason":"max 12 words"}]}`,
    user: JSON.stringify(items),
  });
  return new Map((r.results || []).map((x) => [x.id, x]));
}

// Reads the scanned PDFs with the vision model and returns plain text.
async function readDocuments(links, log) {
  const images = [];
  for (const [key, maxPages] of [['advertisement', 1], ['tenderDocument', MAX_DOC_PAGES]]) {
    if (!links[key]) continue;
    try {
      const { pages } = await readPdf(await fetchPdf(links[key]), maxPages);
      images.push(...pages.map((p) => ({ b64: p.image, mime: p.mime })));
    } catch (e) { log(`  could not read ${key}: ${e.message}`); }
  }
  log(`  reading ${images.length} scanned pages`);
  let text = '';
  for (let i = 0; i < images.length; i += 3) {
    text += '\n' + await chat({
      system: 'You read scanned tender documents.',
      user: 'Extract the key content of these scanned tender pages as compact notes (max 300 words): what is being procured, items and quantities, technical specifications, eligibility and certificates, fees and securities, dates, delivery terms. Skip boilerplate. No commentary.',
      images: images.slice(i, i + 3),
      maxTokens: 700, // Groq's vision model allows only ~1000 output tokens per minute
    });
  }
  return { text: text.slice(0, 16000), pages: images.length };
}

async function analyse(t, d, docs) {
  return chat({
    json: true,
    system: `You are a bid manager at the company below, evaluating a government tender.\nCompany profile:\n${profile()}\n\nReply ONLY with JSON with these keys:
"relevance": "High" | "Medium" | "Low" (how well the tender fits our services),
"score": integer 0-100 (technical fit: could we meet the technical requirements and eligibility?),
"recommendation": start with "Bid", "Consider" or "Skip", then 1-2 sentences why,
"challenges": dependencies, eligibility conditions, certifications, deadlines, risks (max 80 words),
"scope": brief scope of work in about 200 words, plain text, based on the documents.
Use only facts from the tender data; if documents are missing say so in "challenges".`,
    user: JSON.stringify({ tender: t, details: { ...d, links: undefined }, documentText: docs.text || '(documents unavailable)' }),
  });
}

export async function run({ limit = 150, ids, log, stopped }) {
  const state = load();
  const fresh = [];
  log(ids ? `Looking up ${ids.length} specific tenders...` : `Scanning PPRA for new tenders (up to ${limit})...`);
  for (let page = 1; fresh.length < (ids ? ids.length : limit) && !stopped(); page++) {
    const { tenders, total } = await fetchListing(page);
    if (!tenders.length) break;
    for (const t of tenders) {
      if (ids) { if (ids.includes(t.id) && !state.tenders[t.id]) fresh.push(t); continue; } // named tenders skip the screen
      const known = state.tenders[t.id];
      if (known) { // pick up corrigendum date changes
        if (t.closing && t.closing !== known.lastDate) { known.lastDate = t.closing; known.closingTime = t.closingTime; }
      } else if (state.seen[t.id]) continue;
      else if (/cancel/i.test(t.status)) state.seen[t.id] = { decision: 'skip', reason: 'cancelled' };
      else fresh.push(t);
    }
    log(`  page ${page}: ${tenders.length} listed, ${fresh.length} new so far (${total} active in total)`);
  }
  fresh.length = Math.min(fresh.length, limit);
  save(state);
  if (!fresh.length) { log('No new tenders.'); await writeXlsx(state); return; }

  log(`Screening ${fresh.length} new tenders against the company profile...`);
  const relevant = ids ? fresh : [];
  for (let i = 0; !ids && i < fresh.length && !stopped(); i += TRIAGE_BATCH) {
    const batch = fresh.slice(i, i + TRIAGE_BATCH);
    const verdicts = await triage(batch);
    for (const t of batch) {
      const v = verdicts.get(t.id);
      if (!v) continue; // no verdict: leave unseen so the next run retries it
      if (v.relevant) relevant.push(t);
      else state.seen[t.id] = { decision: 'skip', reason: v.reason || '', title: t.title, at: new Date().toISOString() };
    }
    save(state);
    log(`  screened ${Math.min(i + TRIAGE_BATCH, fresh.length)}/${fresh.length}, ${relevant.length} look relevant`);
  }

  log(`Reading documents and scoring ${relevant.length} candidates...`);
  let n = 0;
  for (const t of relevant) {
    if (stopped()) break;
    log(`[${++n}/${relevant.length}] ${t.id} ${t.title}`);
    try {
      const d = await fetchDetail(t.id);
      const docs = await readDocuments(d.links, log);
      log('  scoring');
      const a = await analyse(t, d, docs);
      state.tenders[t.id] = {
        id: t.id, refNo: t.refNo, url: t.url,
        postingDate: t.advertised, lastDate: t.closing, closingTime: t.closingTime,
        department: t.organization, office: t.office, location: t.location,
        name: t.title, category: t.category, sector: t.sector, nature: t.nature, type: t.type,
        relevance: a.relevance, score: Number(a.score) || 0,
        recommendation: a.recommendation, challenges: a.challenges, scope: a.scope,
        contact: [d.contactPerson, d.contactEmail, d.contactPhone].filter(Boolean).join(' | '),
        bidSecurity: d.bidSecurity, bidValidity: d.bidValidity, procedure: d.procedure,
        docs: { tender: d.links.tenderDocument, advertisement: d.links.advertisement, pagesRead: docs.pages },
        analysedAt: new Date().toISOString(),
      };
      state.seen[t.id] = { decision: 'match', at: new Date().toISOString() };
      save(state);
      log(`  -> ${a.relevance}, score ${a.score}`);
    } catch (e) {
      if (/AI API (401|403)|API_KEY|rate limit/.test(e.message)) throw e; // bad key: stop the whole run
      log(`  failed, will retry next run: ${e.message}`);
    }
  }
  await writeXlsx(state).catch((e) => log(`Excel not updated (is the file open?): ${e.message}`));
  log(`Done. ${Object.keys(state.tenders).length} matched tenders stored.`);
}
