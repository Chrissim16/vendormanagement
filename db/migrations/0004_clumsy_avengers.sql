CREATE TABLE "jira_board_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"project_key" text NOT NULL,
	"project_name" text,
	"service_desk_id" text,
	"escalation_method" text NOT NULL,
	"l1_values" text[] DEFAULT '{}' NOT NULL,
	"l2_values" text[] DEFAULT '{}' NOT NULL,
	"l3_values" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_sync_ok" boolean,
	"last_sync_message" text,
	"last_sync_updated" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "jira_links_method_check" CHECK ("jira_board_links"."escalation_method" in ('status', 'label'))
);
--> statement-breakpoint
CREATE TABLE "performance_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"target_tenths" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "targets_metric_check" CHECK ("performance_targets"."metric" in ('first_response', 'first_line', 'sla_breaches', 'backlog_age', 'csat')),
	CONSTRAINT "targets_value_check" CHECK ("performance_targets"."target_tenths" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_link_id" uuid NOT NULL,
	"key" text NOT NULL,
	"summary" text,
	"description" text,
	"status" text,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"first_response_breached" boolean,
	"resolution_breached" boolean,
	"highest_level" integer DEFAULT 1 NOT NULL,
	"csat" integer,
	"csat_at" timestamp with time zone,
	"statuses_seen" text[] DEFAULT '{}' NOT NULL,
	"labels_seen" text[] DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_level_check" CHECK ("tickets"."highest_level" in (1, 2, 3)),
	CONSTRAINT "tickets_csat_check" CHECK ("tickets"."csat" is null or "tickets"."csat" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "jira_board_links" ADD CONSTRAINT "jira_board_links_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_targets" ADD CONSTRAINT "performance_targets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_board_link_id_jira_board_links_id_fk" FOREIGN KEY ("board_link_id") REFERENCES "public"."jira_board_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jira_links_one_per_vendor" ON "jira_board_links" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_links_one_per_board" ON "jira_board_links" USING btree (upper("project_key"));--> statement-breakpoint
CREATE UNIQUE INDEX "targets_one_per_metric" ON "performance_targets" USING btree ("vendor_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_key_per_board" ON "tickets" USING btree ("board_link_id","key");--> statement-breakpoint
CREATE INDEX "tickets_created_idx" ON "tickets" USING btree ("board_link_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_resolved_idx" ON "tickets" USING btree ("board_link_id","resolved_at");--> statement-breakpoint
CREATE INDEX "tickets_csat_idx" ON "tickets" USING btree ("board_link_id","csat_at");