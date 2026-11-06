import { pdf } from 'pdf-to-img';
import { fetchBuffer } from '@/sources/http';
import type { TenderDetail } from '@/sources/types';
import { chat } from './llm';

// Renders the first maxPages pages to base64 PNGs (PPRA files are mostly scans, so always use vision).
export async function readPdf(buf: Buffer, maxPages = 6): Promise<{ totalPages: number; pages: { b64: string; mime: string }[] }> {
  const doc = await pdf(Buffer.from(buf), { scale: 1.5 });
  const pages: { b64: string; mime: string }[] = [];
  for await (const png of doc) {
    pages.push({ b64: Buffer.from(png).toString('base64'), mime: 'image/png' });
    if (pages.length >= maxPages) break;
  }
  return { totalPages: doc.length, pages };
}

// Reads the scanned PDFs with the vision model and returns plain notes. `fileUrl` turns a source-relative link into a full URL.
// A PDF that cannot be downloaded or rendered is skipped (logged); AI errors, including rate limits, propagate.
export async function readDocuments(
  links: TenderDetail['links'],
  fileUrl: (path: string) => string,
  maxPages = 4,
  log: (m: string) => void = () => {},
): Promise<{ text: string; pages: number }> {
  const images: { b64: string; mime: string }[] = [];
  for (const [key, pages] of [['advertisement', 1], ['tenderDocument', maxPages]] as const) {
    const link = links[key];
    if (!link) continue;
    try {
      images.push(...(await readPdf(await fetchBuffer(fileUrl(link)), pages)).pages);
    } catch (e) {
      log(`could not read ${key}: ${(e as Error).message}`);
    }
  }
  if (!images.length) return { text: '', pages: 0 };
  log(`reading ${images.length} scanned pages`);
  let text = '';
  for (let i = 0; i < images.length; i += 3) {
    text += '\n' + (await chat({
      system: 'You read scanned tender documents.',
      user: 'Extract the key content of these scanned tender pages as compact notes (max 300 words): what is being procured, items and quantities, technical specifications, eligibility and certificates, fees and securities, dates, delivery terms. Skip boilerplate. No commentary.',
      images: images.slice(i, i + 3),
      maxTokens: 700, // Groq's vision model allows only ~1000 output tokens per minute
    }));
  }
  return { text: text.trim().slice(0, 16000), pages: images.length };
}
