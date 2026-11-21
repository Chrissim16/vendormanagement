CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sow_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"requested_on" date NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"budget_change_minor" bigint,
	"new_end_date" date,
	"decided_on" date,
	"decided_by" text,
	"budget_before_minor" bigint,
	"end_date_before" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('proposed', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "consultants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sow_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"milestone_id" uuid,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "invoices_amount_check" CHECK ("invoices"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sow_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"delivered_on" date,
	"amount_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "milestones_status_check" CHECK ("milestones"."status" in ('open', 'delivered', 'cancelled')),
	CONSTRAINT "milestones_amount_check" CHECK ("milestones"."amount_minor" is null or "milestones"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_card_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"role" text NOT NULL,
	"day_rate_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "rate_card_rate_check" CHECK ("rate_card_lines"."day_rate_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"gbp_to_eur_e4" integer NOT NULL,
	"notice_days" integer NOT NULL,
	"sow_end_days" integer NOT NULL,
	"budget_warning_pct" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_rate_check" CHECK ("settings"."gbp_to_eur_e4" > 0)
);
--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_sow_id_agreements_id_fk" FOREIGN KEY ("sow_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_sow_id_agreements_id_fk" FOREIGN KEY ("sow_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_sow_id_agreements_id_fk" FOREIGN KEY ("sow_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_sow_idx" ON "change_requests" USING btree ("sow_id");--> statement-breakpoint
CREATE INDEX "consultants_sow_idx" ON "consultants" USING btree ("sow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_per_vendor" ON "invoices" USING btree ("vendor_id",lower("invoice_number"));--> statement-breakpoint
CREATE INDEX "invoices_agreement_idx" ON "invoices" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "milestones_sow_idx" ON "milestones" USING btree ("sow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_one_per_day" ON "rate_card_lines" USING btree ("vendor_id",lower("role"),"valid_from");