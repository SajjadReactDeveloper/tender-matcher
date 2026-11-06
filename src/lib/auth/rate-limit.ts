import { count, eq, lt, sql } from 'drizzle-orm';
import { getDb, withRetry } from '@/db/client';
import { loginAttempts } from '@/db/schema';

export const MAX_PER_IP = 5;
// There is only one account, so a cap that ignores the ip stops attackers rotating addresses.
// Tradeoff: someone hammering the form can lock the owner out for up to 15 minutes.
export const MAX_GLOBAL = 20;

// Reserve first, decide from the count after: concurrent requests cannot all slip under the limit.
// Kept in Postgres because in-memory counters do not survive across serverless instances.
// A blocked reservation is deleted again so a flood cannot extend its own lockout; a failed login keeps its row.
export async function reserveLoginAttempt(ip: string): Promise<{ allowed: boolean; id: number }> {
  const db = getDb();
  const [row] = await withRetry(() => db.insert(loginAttempts).values({ ip }).returning({ id: loginAttempts.id }));
  const [c] = await withRetry(() =>
    db
      // Rank by insertion order: of N simultaneous requests, exactly the first MAX get through.
      .select({ mine: sql<number>`count(*) filter (where ${loginAttempts.ip} = ${ip})`, all: count() })
      .from(loginAttempts)
      .where(sql`${loginAttempts.at} > now() - interval '15 minutes' and ${loginAttempts.id} <= ${row.id}`),
  );
  const allowed = Number(c?.mine ?? 0) <= MAX_PER_IP && Number(c?.all ?? 0) <= MAX_GLOBAL;
  if (!allowed) await withRetry(() => db.delete(loginAttempts).where(eq(loginAttempts.id, row.id)));
  else await withRetry(() => db.delete(loginAttempts).where(lt(loginAttempts.at, sql`now() - interval '1 day'`)));
  return { allowed, id: row.id };
}

// A successful login gives its reservation back, so successes never use up the failure allowance.
export async function releaseLoginAttempt(id: number): Promise<void> {
  await withRetry(() => getDb().delete(loginAttempts).where(eq(loginAttempts.id, id)));
}
