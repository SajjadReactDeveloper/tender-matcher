export type Relevance = 'High' | 'Medium' | 'Low';

// What the AI returns for a tender it has read.
export interface Analysis {
  relevance: Relevance;
  score: number; // 0-100 technical fit
  recommendation: string; // starts with Bid, Consider or Skip
  challenges: string;
  scope: string;
}
