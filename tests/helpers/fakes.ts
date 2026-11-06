import type { PipelineDeps } from '@/jobs/pipeline';
import type { ListedTender, TenderDetail, TenderSource } from '@/sources/types';

export const listed = (id: string, over: Partial<ListedTender> = {}): ListedTender => ({
  externalId: id, title: `Tender ${id}`, note: 'note', description: 'desc', sector: 'IT', refNo: `REF-${id}`, status: 'Published', corrigendum: false,
  advertised: '2026-11-01', closing: '2026-11-30', closingTime: '10:00', organization: 'Org', office: 'Office', location: 'Karachi', type: 'Open', category: 'Services', nature: 'Goods',
  url: `https://example.com/${id}`, ...over,
});

export const detail: TenderDetail = {
  contactPerson: 'A Person', contactEmail: 'a@example.com', contactPhone: '123', procedure: 'Single stage', bidSecurity: '2%', bidValidity: '90 days',
  links: { tenderDocument: '/pdf?file=t', advertisement: '/pdf?file=a' },
};

// A source with `count` tenders, `pageSize` per page. Override tenders by id with `over`.
export function fakeSource(count: number, opts: { pageSize?: number; over?: Record<string, Partial<ListedTender>>; id?: string } = {}): TenderSource & { calls: number[] } {
  const pageSize = opts.pageSize ?? 50;
  const all = Array.from({ length: count }, (_, i) => listed(`T${String(i + 1).padStart(3, '0')}`, opts.over?.[`T${String(i + 1).padStart(3, '0')}`]));
  const calls: number[] = [];
  return {
    id: opts.id ?? 'fake', name: 'Fake', calls,
    listPage: async (page) => { calls.push(page); return { total: all.length, tenders: all.slice((page - 1) * pageSize, page * pageSize) }; },
    getDetail: async () => detail,
    fileUrl: (p) => `https://example.com${p}`,
  };
}

// AI fakes: ids in `relevant` pass screening; analysis returns a fixed High/72 result.
export function fakeDeps(source: TenderSource, relevant: string[], over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    sources: [source],
    screenBatch: async (batch) => new Map(batch.map((t) => [t.externalId, { relevant: relevant.includes(t.externalId), reason: relevant.includes(t.externalId) ? 'fits' : 'not IT' }])),
    analyse: async () => ({ relevance: 'High', score: 72, recommendation: 'Bid - fits us', challenges: 'None', scope: 'Build it' }),
    readDocuments: async () => ({ text: 'doc text', pages: 2 }),
    profile: () => 'profile',
    maxDocPages: 4,
    ...over,
  };
}
