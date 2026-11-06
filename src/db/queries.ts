import { desc, eq, inArray, sql } from 'drizzle-orm';
import { HttpError, redact } from '@/lib/security';
import { getDb, withRetry } from './client';
import { runLogs, runs } from './schema';

export type Run = typeof runs.$inferSelect;
export type RunStatus = Run['status'];

const ACTIVE = ['queued', 'running'] as const;

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: unknown };
  return err?.code === '23505' || (!!err?.cause && isUniqueViolation(err.cause));
};

// The partial unique index runs_one_active makes "only one active run" a database guarantee, not a race.
export async function createRun(limit: number): Promise<Run> {
  try {
    const [run] = await getDb().insert(runs).values({ limit }).returning();
    return run;
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, 'A run is already in progress');
    throw e;
  }
}

export async function setWorkflowRunId(runId: number, workflowRunId: string): Promise<void> {
  await withRetry(() => getDb().update(runs).set({ workflowRunId }).where(eq(runs.id, runId)));
}

export async function markRunning(runId: number): Promise<void> {
  await withRetry(() => getDb().update(runs).set({ status: 'running' }).where(eq(runs.id, runId)));
}

export async function finishRun(runId: number, status: 'completed' | 'failed' | 'cancelled', error?: string): Promise<void> {
  await withRetry(() =>
    getDb().update(runs).set({ status, finishedAt: sql`now()`, error: error ? redact(error).slice(0, 1000) : null }).where(eq(runs.id, runId)),
  );
}

// Flags the active run, if any. The workflow checks the flag between steps.
export async function requestStop(): Promise<Run | null> {
  const [run] = await withRetry(() => getDb().update(runs).set({ stopRequested: true }).where(inArray(runs.status, [...ACTIVE])).returning());
  return run ?? null;
}

export async function isStopRequested(runId: number): Promise<boolean> {
  const [row] = await withRetry(() => getDb().select({ s: runs.stopRequested }).from(runs).where(eq(runs.id, runId)));
  return row?.s ?? false;
}

export async function appendLog(runId: number, message: string): Promise<void> {
  await withRetry(() => getDb().insert(runLogs).values({ runId, message: redact(message).slice(0, 2000) }));
}

export async function bumpCounters(runId: number, d: { screened?: number; matched?: number }): Promise<void> {
  await withRetry(() =>
    getDb()
      .update(runs)
      .set({ screened: sql`${runs.screened} + ${d.screened ?? 0}`, matched: sql`${runs.matched} + ${d.matched ?? 0}` })
      .where(eq(runs.id, runId)),
  );
}

export async function getCurrentRun(): Promise<{ run: Run; logs: { at: string; message: string }[] } | null> {
  const [run] = await withRetry(() => getDb().select().from(runs).orderBy(desc(runs.id)).limit(1));
  if (!run) return null;
  const logs = await withRetry(() => getDb().select({ at: runLogs.at, message: runLogs.message }).from(runLogs).where(eq(runLogs.runId, run.id)).orderBy(desc(runLogs.id)).limit(300));
  return { run, logs: logs.reverse().map((l) => ({ at: l.at.toISOString(), message: l.message })) };
}
