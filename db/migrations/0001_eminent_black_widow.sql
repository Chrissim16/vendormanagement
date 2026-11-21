CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"signed_on" date,
	"start_date" date,
	"end_date" date,
	"end_reason" text,
	"notes" text,
	"parent_msa_id" uuid,
	"pricing" text,
	"budget_minor" bigint,
	"annual_value_minor" bigint,
	"notice_period_days" integer,
	"auto_renews" boolean,
	"renewal_term_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "agreements_kind_check" CHECK ("agreements"."kind" in ('msa', 'sow', 'subscription', 'nda', 'dpa')),
	CONSTRAINT "agreements_status_check" CHECK ("agreements"."status" in ('draft', 'in_negotiation', 'out_for_signature', 'active', 'ended')),
	CONSTRAINT "agreements_dates_check" CHECK ("agreements"."end_date" is null or "agreements"."start_date" is null or "agreements"."end_date" >= "agreements"."start_date"),
	CONSTRAINT "agreements_money_check" CHECK (coalesce("agreements"."budget_minor", 0) >= 0 and coalesce("agreements"."annual_value_minor", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "renewal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_on" date NOT NULL,
	"decided_by" text NOT NULL,
	"notes" text,
	"term_end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"website" text,
	"country" text,
	"description" text,
	"notes" text,
	"scoring_enabled" boolean DEFAULT true NOT NULL,
	"nda_required" boolean DEFAULT true NOT NULL,
	"dpa_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "vendors_type_check" CHECK ("vendors"."type" in ('software', 'consultancy', 'advisory')),
	CONSTRAINT "vendors_status_check" CHECK ("vendors"."status" in ('prospect', 'active', 'on_hold', 'offboarded'))
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_decisions" ADD CONSTRAINT "renewal_decisions_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreements_vendor_idx" ON "agreements" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "agreements_end_idx" ON "agreements" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "contacts_vendor_idx" ON "contacts" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_one_primary" ON "contacts" USING btree ("vendor_id") WHERE "contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "documents_agreement_idx" ON "documents" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_one_per_term" ON "renewal_decisions" USING btree ("agreement_id","term_end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_unique" ON "vendors" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'member'));--> statement-breakpoint
CREATE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'The audit log cannot be changed or removed'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
