import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const FILE = 'data/state.json';
export const XLSX_FILE = 'output/tenders.xlsx';

// state = { seen: { id: { decision, reason, at } }, tenders: { id: {...record} } }
export function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { seen: {}, tenders: {} }; }
}

export function save(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(state));
  fs.renameSync(FILE + '.tmp', FILE);
}

export const tenderList = (state) =>
  Object.values(state.tenders).sort((a, b) => (b.postingDate || '').localeCompare(a.postingDate || ''));

// First nine columns match the team's Google Sheet; the last two are extras.
const COLUMNS = [
  ['Posting Date', 'postingDate', 14], ['Last Date', 'lastDate', 14], ['Department', 'department', 36],
  ['Tender Name', 'name', 40], ['Relevance', 'relevance', 12], ['Technical evaluation score', 'score', 12],
  ['recommendations', 'recommendation', 50], ['Dependencies / challenges', 'challenges', 50],
  ['brief scope 200 words', 'scope', 80], ['Tender No', 'refNo', 18], ['PPRA Link', 'url', 40],
];

export async function buildXlsx(state) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const t of tenderList(state)) {
    const row = ws.addRow({
      ...t,
      postingDate: t.postingDate ? new Date(t.postingDate) : '',
      lastDate: t.lastDate ? new Date(t.lastDate) : '',
      url: { text: t.url, hyperlink: t.url },
    });
    row.alignment = { vertical: 'top', wrapText: true };
  }
  for (const k of ['A', 'B']) ws.getColumn(k).numFmt = 'dd-mmm-yyyy';
  ws.autoFilter = { from: 'A1', to: 'K1' };
  return wb.xlsx.writeBuffer();
}

export async function writeXlsx(state) {
  fs.mkdirSync(path.dirname(XLSX_FILE), { recursive: true });
  fs.writeFileSync(XLSX_FILE, Buffer.from(await buildXlsx(state)));
}
