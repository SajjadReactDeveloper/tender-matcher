import { asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { getDb, withRetry } from './client';
import { aiCalls, auditEvents, runLogs, runs } from './schema';

// Run history with its AI usage totals. Tokens are sums over the run's AI calls (0 when the provider reported none).
export async function listRuns(limit = 100) {
  const rows = await withRetry(() =>
    getDb()
      .select({
        run: runs,
        aiCalls: sql<number>`count(${aiCalls.id})::int`,
        inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
        estCostUsd: sql<string>`coalesce(sum(${aiCalls.estCostUsd}), 0)`,
      })
      .from(runs)
      .leftJoin(aiCalls, eq(aiCalls.runId, runs.id))
      .groupBy(runs.id)
      .orderBy(desc(runs.id))
      .limit(limit),
  );
  return rows.map((r) => ({
    ...r.run,
    aiCalls: r.aiCalls,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    estCostUsd: Number(r.estCostUsd),
    durationSec: r.run.finishedAt ? Math.round((r.run.finishedAt.getTime() - r.run.startedAt.getTime()) / 1000) : null,
  }));
}

// The run page never shows prompt/reply previews (up to 8 KB per call); leaving them out keeps the payload small for big runs.
const aiCallColumns = (({ promptPreview, replyPreview, ...rest }) => (void promptPreview, void replyPreview, rest))(getTableColumns(aiCalls));

export async function getRunDetail(id: number) {
  const [run] = await withRetry(() => getDb().select().from(runs).where(eq(runs.id, id)));
  if (!run) return null;
  const db = getDb();
  const [logs, calls, events] = await Promise.all([
    withRetry(() => db.select({ at: runLogs.at, message: runLogs.message }).from(runLogs).where(eq(runLogs.runId, id)).orderBy(asc(runLogs.id)).limit(1000)),
    withRetry(() => db.select(aiCallColumns).from(aiCalls).where(eq(aiCalls.runId, id)).orderBy(asc(aiCalls.id)).limit(1000)),
    withRetry(() => db.select().from(auditEvents).where(eq(auditEvents.runId, id)).orderBy(asc(auditEvents.id)).limit(1000)),
  ]);
  return { run, logs, aiCalls: calls, events };
}
