import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb, withRetry } from '@/db/client';
import { loginAttempts } from '@/db/schema';

export const MAX_FAILURES = 5;
export const WINDOW_MINUTES = 15;

// Kept in Postgres because in-memory counters do not survive across serverless instances.
export async function checkLoginAllowed(ip: string): Promise<boolean> {
  const [row] = await withRetry(() =>
    getDb().select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.at, sql`now() - interval '15 minutes'`))),
  );
  return Number(row?.n ?? 0) < MAX_FAILURES;
}

export async function recordLoginFailure(ip: string): Promise<void> {
  await withRetry(async () => {
    await getDb().insert(loginAttempts).values({ ip });
    await getDb().delete(loginAttempts).where(lt(loginAttempts.at, sql`now() - interval '1 day'`));
  });
}
