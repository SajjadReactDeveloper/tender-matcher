import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';

export const tenders = pgTable(
  'tenders',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    // pending: scanned, not screened yet; candidate: passed screening, not analysed yet
    decision: text('decision', { enum: ['pending', 'candidate', 'matched', 'skipped'] }).notNull(),
    skipReason: text('skip_reason'),
    title: text('title').notNull(),
    note: text('note'),
    description: text('description'),
    organization: text('organization'),
    office: text('office'),
    location: text('location'),
    category: text('category'),
    sector: text('sector'),
    nature: text('nature'),
    type: text('type'),
    refNo: text('ref_no'),
    url: text('url'),
    postingDate: date('posting_date', { mode: 'string' }),
    closingDate: date('closing_date', { mode: 'string' }),
    closingTime: text('closing_time'),
    relevance: text('relevance', { enum: ['High', 'Medium', 'Low'] }),
    score: integer('score'),
    recommendation: text('recommendation'),
    challenges: text('challenges'),
    scope: text('scope'),
    contact: text('contact'),
    bidSecurity: text('bid_security'),
    bidValidity: text('bid_validity'),
    procedure: text('procedure'),
    docAdvertisement: text('doc_advertisement'),
    docTender: text('doc_tender'),
    pagesRead: integer('pages_read'),
    analysedAt: timestamp('analysed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('tenders_source_external_id').on(t.source, t.externalId), index('tenders_decision_idx').on(t.decision)],
);

export const runs = pgTable(
  'runs',
  {
    id: serial('id').primaryKey(),
    status: text('status', { enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] }).notNull().default('queued'),
    limit: integer('limit').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    stopRequested: boolean('stop_requested').notNull().default(false),
    workflowRunId: text('workflow_run_id'),
    screened: integer('screened').notNull().default(0),
    matched: integer('matched').notNull().default(0),
  },
  (t) => [uniqueIndex('runs_one_active').on(sql`(1)`).where(sql`${t.status} in ('queued', 'running')`)],
);

export const runLogs = pgTable(
  'run_logs',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    message: text('message').notNull(),
  },
  (t) => [index('run_logs_run_idx').on(t.runId, t.id)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: serial('id').primaryKey(),
    ip: text('ip').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_ip_idx').on(t.ip, t.at)],
);

// One row; id is always 1. Null model = use the provider's default.
export const settings = pgTable('settings', {
  id: integer('id').primaryKey(),
  provider: text('provider', { enum: ['groq', 'openai', 'anthropic'] }).notNull(),
  textModel: text('text_model'),
  visionModel: text('vision_model'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// API keys saved from the dashboard, AES-256-GCM encrypted (see src/lib/crypto.ts). Only last4 is ever sent to the browser.
export const apiKeys = pgTable('api_keys', {
  provider: text('provider').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  last4: text('last4').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per provider HTTP attempt (retries and rate limits included). Tokens stay null when the provider reports none.
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    runId: integer('run_id'),
    tenderExternalId: text('tender_external_id'),
    purpose: text('purpose', { enum: ['screen', 'analyse', 'read-pages', 'test'] }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: text('status', { enum: ['ok', 'rate_limited', 'error'] }).notNull(),
    httpStatus: integer('http_status'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    images: integer('images').notNull().default(0),
    promptChars: integer('prompt_chars').notNull().default(0),
    replyChars: integer('reply_chars').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    retryAfterS: integer('retry_after_s'),
    estCostUsd: numeric('est_cost_usd', { precision: 12, scale: 6 }),
    error: text('error'),
    promptPreview: text('prompt_preview'),
    replyPreview: text('reply_preview'),
  },
  (t) => [index('ai_calls_at_idx').on(t.at), index('ai_calls_run_idx').on(t.runId)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    category: text('category', { enum: ['fetch', 'run', 'settings', 'auth'] }).notNull(),
    action: text('action').notNull(),
    status: text('status', { enum: ['ok', 'error', 'info'] }).notNull().default('info'),
    runId: integer('run_id'),
    ref: text('ref'),
    durationMs: integer('duration_ms'),
    details: jsonb('details'),
  },
  (t) => [index('audit_events_at_idx').on(t.at), index('audit_events_cat_idx').on(t.category, t.at)],
);
