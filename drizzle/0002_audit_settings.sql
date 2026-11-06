CREATE TABLE "ai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" integer,
	"tender_external_id" text,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"images" integer DEFAULT 0 NOT NULL,
	"prompt_chars" integer DEFAULT 0 NOT NULL,
	"reply_chars" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"retry_after_s" integer,
	"est_cost_usd" numeric(12, 6),
	"error" text,
	"prompt_preview" text,
	"reply_preview" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"provider" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"last4" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'info' NOT NULL,
	"run_id" integer,
	"ref" text,
	"duration_ms" integer,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"text_model" text,
	"vision_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_calls_at_idx" ON "ai_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_calls_run_idx" ON "ai_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_cat_idx" ON "audit_events" USING btree ("category","at");