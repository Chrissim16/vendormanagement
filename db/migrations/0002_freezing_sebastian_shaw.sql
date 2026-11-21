ALTER TABLE "agreements" ADD CONSTRAINT "agreements_parent_msa_id_agreements_id_fk" FOREIGN KEY ("parent_msa_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
