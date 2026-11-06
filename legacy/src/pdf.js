import { pdf } from 'pdf-to-img';

// Renders the first maxPages pages to base64 PNGs (PPRA files are mostly scans, so always use vision).
export async function readPdf(buf, maxPages = 6) {
  const doc = await pdf(Buffer.from(buf), { scale: 1.5 });
  const pages = [];
  for await (const png of doc) {
    pages.push({ page: pages.length + 1, image: png.toString('base64'), mime: 'image/png' });
    if (pages.length >= maxPages) break;
  }
  return { totalPages: doc.length, pages };
}
