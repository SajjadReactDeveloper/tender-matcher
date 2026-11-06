// A tender as shown on a source's listing page. Dates are YYYY-MM-DD, empty when unknown.
export interface ListedTender {
  externalId: string;
  title: string;
  note: string;
  description: string;
  sector: string;
  refNo: string;
  status: string;
  corrigendum: boolean;
  advertised: string;
  closing: string;
  closingTime: string;
  organization: string;
  office: string;
  location: string;
  type: string;
  category: string;
  nature: string;
  url: string;
}

export interface TenderDetail {
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  procedure: string;
  bidSecurity: string;
  bidValidity: string;
  // Paths relative to the source's own site (the source's `fileUrl` turns them into full URLs).
  links: { advertisement?: string; tenderDocument?: string };
}

// One folder per source implements this; sources/index.ts lists the enabled ones.
export interface TenderSource {
  id: string;
  name: string;
  listPage(page: number): Promise<{ total: number; tenders: ListedTender[] }>;
  getDetail(externalId: string): Promise<TenderDetail>;
  fileUrl(path: string): string;
}

// The source answered, but not in the shape we know: its HTML probably changed.
export class SourceShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceShapeError';
  }
}
