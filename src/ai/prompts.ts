import { z } from 'zod';
import type { Analysis } from '@/domain/types';
import type { ListedTender, TenderDetail } from '@/sources/types';
import { AiError, chat } from './llm';

const screenReply = z.object({ results: z.array(z.object({ id: z.string(), relevant: z.boolean(), reason: z.string().default('') })) });

const analysisReply = z.object({
  relevance: z.enum(['High', 'Medium', 'Low']),
  score: z.coerce.number().int().min(0).max(100),
  recommendation: z.string().min(1),
  challenges: z.string().default(''),
  scope: z.string().default(''),
});

// Quick yes/no per tender from its listing fields. Tenders the model skips get no entry, so the caller can retry them.
export async function screenBatch(batch: ListedTender[], profile: string): Promise<Map<string, { relevant: boolean; reason: string }>> {
  const items = batch.map(({ externalId, title, note, description, sector, category, organization, type }) => ({ id: externalId, title, note, description, sector, category, organization, type }));
  const raw = await chat({
    purpose: 'screen',
    json: true,
    system: `You screen government tenders for a company. Company profile:\n${profile}\n\nFor each tender decide if it could plausibly be a match for the company. If unsure, say relevant. Reply ONLY with JSON: {"results":[{"id":"...","relevant":true|false,"reason":"max 12 words"}]}`,
    user: JSON.stringify(items),
  });
  const parsed = screenReply.safeParse(raw);
  if (!parsed.success) throw new AiError('Invalid screening reply from AI', { retryable: true });
  return new Map(parsed.data.results.map((r) => [r.id, { relevant: r.relevant, reason: r.reason }]));
}

export async function analyse(t: ListedTender, d: TenderDetail, docText: string, profile: string): Promise<Analysis> {
  const raw = await chat({
    purpose: 'analyse',
    json: true,
    system: `You are a bid manager at the company below, evaluating a government tender.\nCompany profile:\n${profile}\n\nReply ONLY with JSON with these keys:
"relevance": "High" | "Medium" | "Low" (how well the tender fits our services),
"score": integer 0-100 (technical fit: could we meet the technical requirements and eligibility?),
"recommendation": start with "Bid", "Consider" or "Skip", then 1-2 sentences why,
"challenges": dependencies, eligibility conditions, certifications, deadlines, risks (max 80 words),
"scope": brief scope of work in about 200 words, plain text, based on the documents.
Use only facts from the tender data; if documents are missing say so in "challenges".`,
    user: JSON.stringify({ tender: t, details: { ...d, links: undefined }, documentText: docText || '(documents unavailable)' }),
  });
  const parsed = analysisReply.safeParse(raw);
  if (!parsed.success) throw new AiError('Invalid analysis reply from AI', { retryable: true });
  return parsed.data;
}
