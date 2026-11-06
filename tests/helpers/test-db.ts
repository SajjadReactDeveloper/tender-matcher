import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';
import { setDb, type Db } from '@/db/client';

// A fresh in-process Postgres with the real migrations applied, installed as the app's db.
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: 'drizzle' });
  setDb(db as unknown as Db);
  return db as unknown as Db;
}
