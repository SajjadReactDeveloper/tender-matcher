CREATE TABLE "app_profile" (
	"id" integer PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
