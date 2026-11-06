import { beforeEach, describe, expect, test } from 'vitest';
import { runs, tenders } from '@/db/schema';
import type { Db } from '@/db/client';
import { createTestDb } from '../helpers/test-db';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe('schema', () => {
  test('rejects a second tender with the same source and external id, allows the same id from another source', async () => {
    await db.insert(tenders).values({ source: 'ppra', externalId: 'T1', decision: 'skipped', title: 'a' });
    await expect(db.insert(tenders).values({ source: 'ppra', externalId: 'T1', decision: 'skipped', title: 'b' })).rejects.toThrow();
    await expect(db.insert(tenders).values({ source: 'other', externalId: 'T1', decision: 'skipped', title: 'c' })).resolves.toBeDefined();
  });

  test('allows only one active run at a time, but any number of finished ones', async () => {
    await db.insert(runs).values({ limit: 10, status: 'running' });
    await expect(db.insert(runs).values({ limit: 10, status: 'queued' })).rejects.toThrow();
    await db.insert(runs).values([{ limit: 10, status: 'completed' }, { limit: 10, status: 'failed' }]);
    expect(await db.select().from(runs)).toHaveLength(3);
  });
});
