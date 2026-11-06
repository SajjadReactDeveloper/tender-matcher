import ExcelJS from 'exceljs';
import type { TenderView } from '@/domain/types';

// The first nine columns match the team's Google Sheet; the last two are extras.
const COLUMNS: [header: string, key: keyof TenderView, width: number][] = [
  ['Posting Date', 'postingDate', 14], ['Last Date', 'lastDate', 14], ['Department', 'department', 36], ['Tender Name', 'name', 40],
  ['Relevance', 'relevance', 12], ['Technical evaluation score', 'score', 12], ['recommendations', 'recommendation', 50],
  ['Dependencies / challenges', 'challenges', 50], ['brief scope 200 words', 'scope', 80], ['Tender No', 'refNo', 18], ['PPRA Link', 'url', 40],
];

const toDate = (s: string) => (s ? new Date(s) : '');

export async function buildXlsx(list: TenderView[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tenders', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const t of list) {
    // Only plain strings are ever written (never formula objects), so text such as "=HYPERLINK(...)" stays text in Excel.
    const row = ws.addRow({ ...t, postingDate: toDate(t.postingDate), lastDate: toDate(t.lastDate), url: /^https?:\/\//.test(t.url) ? { text: t.url, hyperlink: t.url } : '' });
    row.alignment = { vertical: 'top', wrapText: true };
  }
  for (const k of ['A', 'B']) ws.getColumn(k).numFmt = 'dd-mmm-yyyy';
  ws.autoFilter = { from: 'A1', to: 'K1' };
  return wb.xlsx.writeBuffer();
}
