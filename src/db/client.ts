import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Db | undefined;

// Lazy so importing this module never needs DATABASE_URL (builds and tests run without it). Reads only that one variable on purpose.
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    db = drizzle(neon(url), { schema }) as unknown as Db;
  }
  return db;
}

// Tests swap in an in-process Postgres (PGlite); pass undefined to reset.
export function setDb(next: Db | undefined): void {
  db = next;
}

const CONNECTION_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']);

const isConnectionError = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string; cause?: unknown };
  return (!!err?.code && CONNECTION_CODES.has(err.code)) || /fetch failed|connection terminated|timeout/i.test(err?.message ?? '') || (!!err?.cause && isConnectionError(err.cause));
};

// Neon free tier suspends when idle; the first query after a pause can fail once.
export async function withRetry<T>(fn: () => Promise<T>, delayMs = 500): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 2 || !isConnectionError(e)) throw e;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}
