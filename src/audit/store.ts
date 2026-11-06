import { and, desc, eq, gte, ilike, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { aiCalls, auditEvents } from '@/db/schema';
import { redact } from '@/lib/security';

const PREVIEW = 4000;
const DETAILS = 8000;

export interface NewEvent {
  category: 'fetch' | 'run' | 'settings' | 'auth';
  action: string;
  status?: 'ok' | 'error' | 'info';
  runId?: number;
  ref?: string;
  durationMs?: number;
  details?: unknown;
}

export type NewAiCall = Omit<typeof aiCalls.$inferInsert, 'id' | 'at'>;

const clean = (s: string | null | undefined, max: number) => (s == null ? s : redact(s).slice(0, max));

// Audit writes must never break the work they describe: log the message (never the payload) and move on.
const safely = async (fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (e) {
    console.error('audit write failed:', (e as Error).message);
  }
};

// Redacts string values one by one so the JSON stays valid; oversized details are replaced by a marker rather than cut mid-structure.
const redactJson = (v: unknown): unknown => {
  if (typeof v === 'string') return redact(v).slice(0, 1000);
  if (Array.isArray(v)) return v.map(redactJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactJson(x)]));
  return v;
};

export const recordEvent = (e: NewEvent): Promise<void> =>
  safely(async () => {
    let details = e.details === undefined ? null : redactJson(e.details);
    if (details && JSON.stringify(details).length > DETAILS) details = { truncated: true };
    await getDb().insert(auditEvents).values({ category: e.category, action: e.action, status: e.status ?? 'info', runId: e.runId, ref: clean(e.ref, 200), durationMs: e.durationMs, details });
  });

export const recordAiCall = (c: NewAiCall): Promise<void> =>
  safely(() => getDb().insert(aiCalls).values({ ...c, error: clean(c.error, 1000), promptPreview: clean(c.promptPreview, PREVIEW), replyPreview: clean(c.replyPreview, PREVIEW) }));

export async function pruneAudit(days = 180): Promise<void> {
  await safely(async () => {
    const cutoff = sql`now() - make_interval(days => ${days})`;
    await getDb().delete(auditEvents).where(lt(auditEvents.at, cutoff));
    await getDb().delete(aiCalls).where(lt(aiCalls.at, cutoff));
  });
}

export interface Filter {
  category?: string;
  status?: string;
  runId?: number;
  q?: string;
  from?: string;
  to?: string;
  before?: number;
  limit?: number;
}

const page = <T extends { id: number }>(rows: T[], limit: number) => ({ rows: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null });
const clampLimit = (n?: number) => Math.min(Math.max(n ?? 50, 1), 200);
const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

export async function listAuditEvents(f: Filter) {
  const limit = clampLimit(f.limit);
  const w: (SQL | undefined)[] = [
    f.category ? eq(auditEvents.category, f.category as 'fetch') : undefined,
    f.status ? eq(auditEvents.status, f.status as 'ok') : undefined,
    f.runId ? eq(auditEvents.runId, f.runId) : undefined,
    f.from ? gte(auditEvents.at, new Date(f.from)) : undefined,
    f.to ? lte(auditEvents.at, new Date(f.to)) : undefined,
    f.before ? lt(auditEvents.id, f.before) : undefined,
    f.q ? or(ilike(auditEvents.action, like(f.q)), ilike(auditEvents.ref, like(f.q)), sql`${auditEvents.details}::text ilike ${like(f.q)}`) : undefined,
  ];
  const rows = await getDb().select().from(auditEvents).where(and(...w)).orderBy(desc(auditEvents.id)).limit(limit + 1);
  return page(rows, limit);
}

export async function listAiCalls(f: Filter) {
  const limit = clampLimit(f.limit);
  const w: (SQL | undefined)[] = [
    f.status ? eq(aiCalls.status, f.status as 'ok') : undefined,
    f.runId ? eq(aiCalls.runId, f.runId) : undefined,
    f.from ? gte(aiCalls.at, new Date(f.from)) : undefined,
    f.to ? lte(aiCalls.at, new Date(f.to)) : undefined,
    f.before ? lt(aiCalls.id, f.before) : undefined,
    f.q ? or(ilike(aiCalls.model, like(f.q)), ilike(aiCalls.tenderExternalId, like(f.q)), ilike(aiCalls.purpose, like(f.q))) : undefined,
  ];
  const rows = await getDb().select().from(aiCalls).where(and(...w)).orderBy(desc(aiCalls.id)).limit(limit + 1);
  return page(rows, limit);
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  rateLimited: number;
  errors: number;
  estCostUsd: number;
  byModel: { provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; estCostUsd: number }[];
}

export async function usageSummary(sinceHours: number): Promise<Usage> {
  const since = sql`now() - make_interval(hours => ${sinceHours})`;
  const rows = await getDb()
    .select({
      provider: aiCalls.provider,
      model: aiCalls.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
      rateLimited: sql<number>`count(*) filter (where ${aiCalls.status} = 'rate_limited')::int`,
      errors: sql<number>`count(*) filter (where ${aiCalls.status} = 'error')::int`,
      cost: sql<string>`coalesce(sum(${aiCalls.estCostUsd}), 0)`,
    })
    .from(aiCalls)
    .where(gte(aiCalls.at, since))
    .groupBy(aiCalls.provider, aiCalls.model);
  const total: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, rateLimited: 0, errors: 0, estCostUsd: 0, byModel: [] };
  for (const r of rows) {
    const cost = Number(r.cost);
    total.calls += r.calls;
    total.inputTokens += r.inputTokens;
    total.outputTokens += r.outputTokens;
    total.rateLimited += r.rateLimited;
    total.errors += r.errors;
    total.estCostUsd += cost;
    total.byModel.push({ provider: r.provider, model: r.model, calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, estCostUsd: cost });
  }
  return total;
}
