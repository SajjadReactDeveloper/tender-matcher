CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"limit" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"workflow_run_id" text,
	"screened" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"decision" text NOT NULL,
	"skip_reason" text,
	"title" text NOT NULL,
	"organization" text,
	"office" text,
	"location" text,
	"category" text,
	"sector" text,
	"nature" text,
	"type" text,
	"ref_no" text,
	"url" text,
	"posting_date" date,
	"closing_date" date,
	"closing_time" text,
	"relevance" text,
	"score" integer,
	"recommendation" text,
	"challenges" text,
	"scope" text,
	"contact" text,
	"bid_security" text,
	"bid_validity" text,
	"procedure" text,
	"doc_advertisement" text,
	"doc_tender" text,
	"pages_read" integer,
	"analysed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenders_source_external_id" UNIQUE("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "run_logs" ADD CONSTRAINT "run_logs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "run_logs_run_idx" ON "run_logs" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active" ON "runs" USING btree ((1)) WHERE "runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "tenders_decision_idx" ON "tenders" USING btree ("decision");