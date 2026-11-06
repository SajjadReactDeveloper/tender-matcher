import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, serial, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';

export const tenders = pgTable(
  'tenders',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    decision: text('decision', { enum: ['matched', 'skipped'] }).notNull(),
    skipReason: text('skip_reason'),
    title: text('title').notNull(),
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
