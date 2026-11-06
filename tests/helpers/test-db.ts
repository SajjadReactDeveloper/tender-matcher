import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';
import { setDb, type Db } from '@/db/client';

let cached: Promise<Db> | undefined;

// An in-process Postgres with the real migrations applied, installed as the app's db.
// Created once per test file (starting one is slow); every call hands back empty tables with ids restarted.
export async function createTestDb(): Promise<Db> {
  cached ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: 'drizzle' });
    return db as unknown as Db;
  })();
  const db = await cached;
  await db.execute(sql`truncate table tenders, runs, run_logs, login_attempts, settings, api_keys, ai_calls, audit_events restart identity cascade`);
  setDb(db);
  return db;
}
