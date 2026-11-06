export type Relevance = 'High' | 'Medium' | 'Low';

// What the AI returns for a tender it has read.
export interface Analysis {
  relevance: Relevance;
  score: number; // 0-100 technical fit
  recommendation: string; // starts with Bid, Consider or Skip
  challenges: string;
  scope: string;
}

// A matched tender as the dashboard and the Excel export see it.
export interface TenderView {
  id: number;
  source: string;
  externalId: string;
  refNo: string;
  url: string;
  postingDate: string;
  lastDate: string;
  closingTime: string;
  department: string;
  office: string;
  location: string;
  name: string;
  category: string;
  sector: string;
  nature: string;
  type: string;
  relevance: Relevance;
  score: number;
  recommendation: string;
  challenges: string;
  scope: string;
  contact: string;
  bidSecurity: string;
  bidValidity: string;
  procedure: string;
  docs: { advertisement: string; tender: string; pagesRead: number };
}
