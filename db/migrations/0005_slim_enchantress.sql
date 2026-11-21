CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_summary" text,
	"output" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestions_status_check" CHECK ("ai_suggestions"."status" in ('proposed', 'accepted', 'edited', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "monthly_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"month" text NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"scores" jsonb NOT NULL,
	"themes" jsonb NOT NULL,
	"tickets_read" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_month_check" CHECK ("monthly_proposals"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "scorecard_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"weight" integer NOT NULL,
	"source" text NOT NULL,
	"metrics" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "criteria_source_check" CHECK ("scorecard_criteria"."source" in ('measured', 'manual')),
	CONSTRAINT "criteria_weight_check" CHECK ("scorecard_criteria"."weight" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "scorecard_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"score" integer,
	"vendor_comment" text,
	"internal_note" text,
	"suggested_score" integer,
	"accepted_suggestion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "scorecard_lines_score_check" CHECK ("scorecard_lines"."score" is null or "scorecard_lines"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"summary" text,
	"finalised_at" timestamp with time zone,
	"finalised_by" text,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "scorecards_status_check" CHECK ("scorecards"."status" in ('draft', 'final')),
	CONSTRAINT "scorecards_period_check" CHECK ("scorecards"."period_end" > "scorecards"."period_start")
);
--> statement-breakpoint
ALTER TABLE "monthly_proposals" ADD CONSTRAINT "monthly_proposals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_proposals" ADD CONSTRAINT "monthly_proposals_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_lines" ADD CONSTRAINT "scorecard_lines_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_lines" ADD CONSTRAINT "scorecard_lines_criterion_id_scorecard_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."scorecard_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_subject_idx" ON "ai_suggestions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_one_per_month" ON "monthly_proposals" USING btree ("vendor_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_name_unique" ON "scorecard_criteria" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_lines_one_per_criterion" ON "scorecard_lines" USING btree ("scorecard_id","criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_one_per_quarter" ON "scorecards" USING btree ("vendor_id","period_start");--> statement-breakpoint
-- The starting set of criteria (domain model). An admin can change them afterwards.
INSERT INTO "scorecard_criteria" ("name", "description", "weight", "source", "metrics", "sort_order", "created_by", "updated_by") VALUES
  ('Quality of delivery', 'How well tickets are solved the first time, and how users rate the result. Without a helpdesk: the quality of what was delivered.', 20, 'measured', '{first_line,csat}', 1, 'system', 'system'),
  ('Timeliness', 'Speed of first response and resolution against the contract. Without a helpdesk: milestones delivered on time.', 20, 'measured', '{first_response,sla_breaches,backlog_age}', 2, 'system', 'system'),
  ('Responsiveness and communication', 'How easy they are to reach and how clearly they report.', 20, 'manual', '{}', 3, 'system', 'system'),
  ('Value for money', 'What is delivered for what is paid, and whether budgets are kept.', 20, 'manual', '{}', 4, 'system', 'system'),
  ('Compliance and security', 'Whether the paperwork is in place and agreements on data and security are kept.', 20, 'manual', '{}', 5, 'system', 'system');
