import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { tenders } from '@/db/schema';
import type { Db } from '@/db/client';
import { importState, type LegacyState } from '@/lib/import-state';
import { createTestDb } from './helpers/test-db';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const legacy: LegacyState = {
  seen: {
    M1: { decision: 'match', at: '2026-11-01T00:00:00Z' },
    M2: { decision: 'match', at: '2026-11-01T00:00:00Z' },
    S1: { decision: 'skip', reason: 'Only welding tools', title: 'Welder kits', at: '2026-10-26T00:00:00Z' },
    S2: { decision: 'skip', reason: 'cancelled', at: '2026-10-26T00:00:00Z' }, // no title recorded
    S3: { decision: 'skip', title: 'Paint', at: '2026-10-26T00:00:00Z' }, // no reason recorded
  },
  tenders: {
    M1: {
      id: 'M1', refNo: 'REF-1', url: 'https://epms.ppra.gov.pk/public/tenders/tender-details/M1', postingDate: '2026-11-01', lastDate: '2026-11-20', closingTime: '10:00 AM',
      department: 'Ministry A', office: 'Office A', location: 'Karachi', name: 'Build a portal', category: 'Services', sector: 'IT', nature: 'Services', type: 'Open',
      relevance: 'High', score: 85, recommendation: 'Bid - fits', challenges: 'Certs needed', scope: 'Portal', contact: 'A | a@x.com | 123', bidSecurity: '2%', bidValidity: '90 days',
      procedure: 'Single stage', docs: { tender: '/pdf?file=t', advertisement: '/pdf?file=a', pagesRead: 5 }, analysedAt: '2026-11-01T05:00:00Z',
    },
    M2: {
      id: 'M2', refNo: '', url: 'https://epms.ppra.gov.pk/public/tenders/tender-details/M2', postingDate: '2026-11-02', lastDate: '2026-11-25', closingTime: '',
      department: 'Ministry B', name: 'Another', relevance: 'Medium', score: 55, recommendation: 'Consider - maybe', challenges: '', scope: '', docs: { pagesRead: 0 },
    },
  },
};

describe('importState', () => {
  test('imports matched tenders as matched and the remaining screened ids as skipped, then does nothing the second time', async () => {
    expect(await importState(legacy)).toEqual({ matched: 2, skipped: 3 });
    expect(await importState(legacy)).toEqual({ matched: 0, skipped: 0 });
    expect(await db.select().from(tenders)).toHaveLength(5);
  });

  test('maps a legacy matched tender onto the new columns', async () => {
    await importState(legacy);
    const [t] = await db.select().from(tenders).where(eq(tenders.externalId, 'M1'));
    expect(t).toMatchObject({
      source: 'ppra', decision: 'matched', title: 'Build a portal', organization: 'Ministry A', postingDate: '2026-11-01', closingDate: '2026-11-20', closingTime: '10:00 AM',
      relevance: 'High', score: 85, recommendation: 'Bid - fits', bidSecurity: '2%', docTender: '/pdf?file=t', docAdvertisement: '/pdf?file=a', pagesRead: 5, refNo: 'REF-1',
    });
    expect(t.analysedAt?.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  test('skipped entries keep their reason and title, falling back to the id when the old state had no title', async () => {
    await importState(legacy);
    const rows = Object.fromEntries((await db.select().from(tenders).where(eq(tenders.decision, 'skipped'))).map((r) => [r.externalId, r]));
    expect(rows.S1).toMatchObject({ title: 'Welder kits', skipReason: 'Only welding tools' });
    expect(rows.S2).toMatchObject({ title: 'S2', skipReason: 'cancelled' });
    expect(rows.S3.skipReason).toBeNull();
  });

  test('an empty or partial legacy file imports nothing and does not throw', async () => {
    expect(await importState({ seen: {}, tenders: {} })).toEqual({ matched: 0, skipped: 0 });
    expect(await importState({} as LegacyState)).toEqual({ matched: 0, skipped: 0 });
  });

  test('a matched id that is also in the existing database is left untouched (idempotent, never overwrites newer data)', async () => {
    await importState({ seen: {}, tenders: { M2: legacy.tenders.M2 } });
    await db.update(tenders).set({ score: 99 }).where(eq(tenders.externalId, 'M2'));
    await importState(legacy);
    const [t] = await db.select().from(tenders).where(eq(tenders.externalId, 'M2'));
    expect(t.score).toBe(99);
  });
});

describe('importState upgrades', () => {
  test('a legacy matched tender upgrades a row the new app has only screened or skipped, keeping its analysis', async () => {
    await db.insert(tenders).values([
      { source: 'ppra', externalId: 'M1', decision: 'candidate', title: 'Build a portal' },
      { source: 'ppra', externalId: 'M2', decision: 'skipped', title: 'Another', skipReason: 'not IT' },
    ]);
    expect(await importState(legacy)).toEqual({ matched: 2, skipped: 3 });
    const rows = Object.fromEntries((await db.select().from(tenders)).map((r) => [r.externalId, r]));
    expect(rows.M1).toMatchObject({ decision: 'matched', score: 85, recommendation: 'Bid - fits' });
    expect(rows.M2).toMatchObject({ decision: 'matched', score: 55 });
  });
});

describe('company profile', () => {
  const profile = readFileSync('config/profile.md', 'utf8');
  const [wanted, notMatch] = profile.split('## Not a match');

  test('hardware supply is no longer a match', () => {
    expect(wanted).not.toMatch(/IT hardware and equipment supply/i);
    expect(wanted).not.toMatch(/\bhardware\b/i);
  });

  test('hardware, connectivity, equipment maintenance and licence resale are listed as not a match', () => {
    for (const phrase of ['hardware supply', 'connectivity', 'equipment maintenance', 'licence resale']) expect(notMatch.toLowerCase()).toContain(phrase);
  });

  test('the software and services focus is still there', () => {
    expect(wanted).toMatch(/Software development/);
    expect(wanted).toMatch(/AI\/ML/);
  });
});
