CREATE TABLE "rfp_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "rfp_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"list" text NOT NULL,
	"reason" text NOT NULL,
	"issued_on" date,
	"nda_warning_acknowledged_by" text,
	"response_received_on" date,
	"unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "rfp_candidates_list_check" CHECK ("rfp_candidates"."list" in ('longlist', 'shortlist', 'dropped'))
);
--> statement-breakpoint
CREATE TABLE "rfp_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"weight" integer NOT NULL,
	"part" text NOT NULL,
	CONSTRAINT "rfp_criteria_part_check" CHECK ("rfp_criteria"."part" in ('written', 'demo')),
	CONSTRAINT "rfp_criteria_weight_check" CHECK ("rfp_criteria"."weight" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "rfp_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"text" text NOT NULL,
	"criterion_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfp_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"evaluator_user_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"suggested_score" integer,
	"suggestion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "rfp_scores_score_check" CHECK ("rfp_scores"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "rfp_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"heading" text NOT NULL,
	"body" text
);
--> statement-breakpoint
CREATE TABLE "rfp_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfp_id" uuid NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_role" text,
	"outcome" text NOT NULL,
	"on_date" date NOT NULL,
	"comment" text,
	"resolved_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "rfp_signoffs_outcome_check" CHECK ("rfp_signoffs"."outcome" in ('approved', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "rfps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"need" text NOT NULL,
	"budget_minor" bigint,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"sponsor" text,
	"demand_approved_on" date,
	"target_decision_date" date,
	"owner_user_id" uuid NOT NULL,
	"stage" text DEFAULT 'drafting' NOT NULL,
	"written_weight" integer DEFAULT 70 NOT NULL,
	"demo_weight" integer DEFAULT 30 NOT NULL,
	"draft_suggestion_id" uuid,
	"comparison_suggestion_id" uuid,
	"comparison_answers" text,
	"winner_candidate_id" uuid,
	"decided_on" date,
	"rationale" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "rfps_stage_check" CHECK ("rfps"."stage" in ('drafting', 'in_review', 'approved', 'issued', 'evaluating', 'decided', 'cancelled')),
	CONSTRAINT "rfps_weights_check" CHECK ("rfps"."written_weight" >= 0 and "rfps"."demo_weight" >= 0 and "rfps"."written_weight" + "rfps"."demo_weight" = 100),
	CONSTRAINT "rfps_budget_check" CHECK (coalesce("rfps"."budget_minor", 0) >= 0),
	CONSTRAINT "rfps_decision_check" CHECK ("rfps"."stage" <> 'decided' or ("rfps"."winner_candidate_id" is not null and "rfps"."decided_on" is not null and "rfps"."rationale" is not null))
);
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "agreement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "rfp_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "rfp_answers" ADD CONSTRAINT "rfp_answers_candidate_id_rfp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."rfp_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_answers" ADD CONSTRAINT "rfp_answers_question_id_rfp_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."rfp_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_candidates" ADD CONSTRAINT "rfp_candidates_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_candidates" ADD CONSTRAINT "rfp_candidates_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_criteria" ADD CONSTRAINT "rfp_criteria_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_questions" ADD CONSTRAINT "rfp_questions_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_questions" ADD CONSTRAINT "rfp_questions_criterion_id_rfp_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rfp_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_scores" ADD CONSTRAINT "rfp_scores_candidate_id_rfp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."rfp_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_scores" ADD CONSTRAINT "rfp_scores_criterion_id_rfp_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rfp_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_scores" ADD CONSTRAINT "rfp_scores_evaluator_user_id_users_id_fk" FOREIGN KEY ("evaluator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_scores" ADD CONSTRAINT "rfp_scores_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_sections" ADD CONSTRAINT "rfp_sections_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_signoffs" ADD CONSTRAINT "rfp_signoffs_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_draft_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("draft_suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_comparison_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("comparison_suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_winner_candidate_id_rfp_candidates_id_fk" FOREIGN KEY ("winner_candidate_id") REFERENCES "public"."rfp_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_answers_one_per_question" ON "rfp_answers" USING btree ("candidate_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_candidates_one_per_vendor" ON "rfp_candidates" USING btree ("rfp_id","vendor_id");--> statement-breakpoint
CREATE INDEX "rfp_criteria_rfp_idx" ON "rfp_criteria" USING btree ("rfp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_questions_number_unique" ON "rfp_questions" USING btree ("rfp_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "rfp_scores_one_per_evaluator" ON "rfp_scores" USING btree ("candidate_id","criterion_id","evaluator_user_id");--> statement-breakpoint
CREATE INDEX "rfp_sections_rfp_idx" ON "rfp_sections" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "rfp_signoffs_rfp_idx" ON "rfp_signoffs" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "rfps_stage_idx" ON "rfps" USING btree ("stage");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_rfp_candidate_id_rfp_candidates_id_fk" FOREIGN KEY ("rfp_candidate_id") REFERENCES "public"."rfp_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_candidate_idx" ON "documents" USING btree ("rfp_candidate_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK (("documents"."agreement_id" is null) <> ("documents"."rfp_candidate_id" is null));