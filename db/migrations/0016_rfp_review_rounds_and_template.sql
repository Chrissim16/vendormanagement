CREATE TABLE "rfp_review_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfp_review_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL,
	"made_by" text NOT NULL,
	CONSTRAINT "rfp_review_rounds_version_check" CHECK ("rfp_review_rounds"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rfp_reviewer_remarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"rfp_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"author" text NOT NULL,
	"section_id" uuid,
	"found_under" text NOT NULL,
	"anchor_text" text,
	"text" text,
	"removed_text" text,
	"added_text" text,
	"before_text" text,
	"after_text" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "rfp_reviewer_remarks_kind_check" CHECK ("rfp_reviewer_remarks"."kind" in ('comment', 'suggested_edit')),
	CONSTRAINT "rfp_reviewer_remarks_status_check" CHECK ("rfp_reviewer_remarks"."status" in ('open', 'dealt_with', 'set_aside')),
	CONSTRAINT "rfp_reviewer_remarks_resolved_check" CHECK (("rfp_reviewer_remarks"."status" = 'open') = ("rfp_reviewer_remarks"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "word_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"found" jsonb NOT NULL,
	"in_force" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfp_sections" ADD COLUMN "rewrite_suggestion_id" uuid;--> statement-breakpoint
ALTER TABLE "rfp_sections" ADD COLUMN "rewrite_for" jsonb;--> statement-breakpoint
ALTER TABLE "rfp_review_files" ADD CONSTRAINT "rfp_review_files_round_id_rfp_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rfp_review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_review_rounds" ADD CONSTRAINT "rfp_review_rounds_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_reviewer_remarks" ADD CONSTRAINT "rfp_reviewer_remarks_file_id_rfp_review_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."rfp_review_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_reviewer_remarks" ADD CONSTRAINT "rfp_reviewer_remarks_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_reviewer_remarks" ADD CONSTRAINT "rfp_reviewer_remarks_section_id_rfp_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."rfp_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_review_files_once" ON "rfp_review_files" USING btree ("round_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_review_rounds_version" ON "rfp_review_rounds" USING btree ("rfp_id","version");--> statement-breakpoint
CREATE INDEX "rfp_reviewer_remarks_rfp_idx" ON "rfp_reviewer_remarks" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "rfp_reviewer_remarks_file_idx" ON "rfp_reviewer_remarks" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "word_templates_one_in_force" ON "word_templates" USING btree ("in_force") WHERE "word_templates"."in_force";--> statement-breakpoint
ALTER TABLE "rfp_sections" ADD CONSTRAINT "rfp_sections_rewrite_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("rewrite_suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;