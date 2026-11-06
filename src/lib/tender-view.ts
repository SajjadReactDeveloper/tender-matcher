import type { TenderRow } from '@/db/tenders';
import type { TenderView } from '@/domain/types';
import { sources } from '@/sources';

// Document links are stored relative to their source; the browser needs full URLs.
const docUrl = (source: string, path: string | null): string => (path ? (sources.find((s) => s.id === source)?.fileUrl(path) ?? '') : '');

export const toView = (r: TenderRow): TenderView => ({
  id: r.id, source: r.source, externalId: r.externalId, refNo: r.refNo ?? '', url: r.url ?? '', postingDate: r.postingDate ?? '', lastDate: r.closingDate ?? '',
  closingTime: r.closingTime ?? '', department: r.organization ?? '', office: r.office ?? '', location: r.location ?? '', name: r.title, category: r.category ?? '',
  sector: r.sector ?? '', nature: r.nature ?? '', type: r.type ?? '', relevance: r.relevance ?? 'Low', score: r.score ?? 0, recommendation: r.recommendation ?? '',
  challenges: r.challenges ?? '', scope: r.scope ?? '', contact: r.contact ?? '', bidSecurity: r.bidSecurity ?? '', bidValidity: r.bidValidity ?? '', procedure: r.procedure ?? '',
  docs: { advertisement: docUrl(r.source, r.docAdvertisement), tender: docUrl(r.source, r.docTender), pagesRead: r.pagesRead ?? 0 },
});
