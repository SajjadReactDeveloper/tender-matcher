import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { analyse, screenBatch } from '@/ai/prompts';
import { readDocuments } from '@/ai/pdf';
import type { ListedTender, TenderDetail } from '@/sources/types';
import { stubAiReply } from '../helpers/ai';

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'groq');
  vi.stubEnv('GROQ_API_KEY', 'test-groq-key-1234567890');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const tender = (id: string): ListedTender => ({
  externalId: id, title: `Tender ${id}`, note: '', description: '', sector: '', refNo: '', status: 'Published', corrigendum: false,
  advertised: '2026-11-01', closing: '2026-11-20', closingTime: '10:00', organization: 'Org', office: '', location: '', type: '', category: '', nature: '', url: `https://x/${id}`,
});
const detail: TenderDetail = { contactPerson: '', contactEmail: '', contactPhone: '', procedure: '', bidSecurity: '', bidValidity: '', links: {} };
const good = { relevance: 'High', score: 72, recommendation: 'Bid - fits', challenges: 'None', scope: 'Build a system' };

describe('screenBatch', () => {
  test('returns a verdict per id the model answered and omits the rest', async () => {
    stubAiReply({ results: [{ id: 'A', relevant: true, reason: 'software' }, { id: 'B', relevant: false, reason: 'civil works' }] });
    const out = await screenBatch([tender('A'), tender('B'), tender('C')], 'profile');
    expect(out.get('A')).toEqual({ relevant: true, reason: 'software' });
    expect(out.get('B')?.relevant).toBe(false);
    expect(out.has('C')).toBe(false);
  });
});

describe('analyse', () => {
  test('accepts a valid reply and coerces a numeric string score', async () => {
    stubAiReply({ ...good, score: '72' });
    expect(await analyse(tender('A'), detail, 'doc text', 'profile')).toEqual(good);
  });

  test('rejects a score outside 0-100', async () => {
    stubAiReply({ ...good, score: 150 });
    await expect(analyse(tender('A'), detail, '', 'profile')).rejects.toThrow(/invalid analysis/i);
  });

  test('rejects an unknown relevance value', async () => {
    stubAiReply({ ...good, relevance: 'Maybe' });
    await expect(analyse(tender('A'), detail, '', 'profile')).rejects.toThrow(/invalid analysis/i);
  });
});

describe('readDocuments', () => {
  test('returns empty text and zero pages when the tender has no document links', async () => {
    expect(await readDocuments({}, (p) => p, 4)).toEqual({ text: '', pages: 0 });
  });
});
