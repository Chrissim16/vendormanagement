CREATE TABLE "contact_role_links" (
	"contact_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "contact_role_links_contact_id_role_id_pk" PRIMARY KEY("contact_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "contact_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "contact_role_links" ADD CONSTRAINT "contact_role_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_role_links" ADD CONSTRAINT "contact_role_links_role_id_contact_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."contact_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_role_links_role_idx" ON "contact_role_links" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_roles_name_unique" ON "contact_roles" USING btree (lower("name"));--> statement-breakpoint
-- The starting list of contact roles (V-7).
INSERT INTO "contact_roles" ("name", "created_by", "updated_by")
SELECT r, 'migration', 'migration' FROM unnest(ARRAY['Account Manager', 'Billing / Finance', 'Consultant', 'Delivery Manager', 'Developer', 'Executive Sponsor', 'Helpdesk', 'Legal / Contracts', 'Program Manager', 'Project Manager', 'Support Manager', 'Technical Contact']) AS r;--> statement-breakpoint
-- Every job title typed before becomes a role, written as it was first typed, so nothing is lost.
INSERT INTO "contact_roles" ("name", "created_by", "updated_by")
SELECT DISTINCT ON (lower(t)) t, 'migration', 'migration'
FROM (SELECT regexp_replace(btrim("job_title"), '\s+', ' ', 'g') AS t, "created_at" FROM "contacts" WHERE "job_title" IS NOT NULL AND btrim("job_title") <> '') AS titles
WHERE NOT EXISTS (SELECT 1 FROM "contact_roles" r WHERE lower(r."name") = lower(titles.t))
ORDER BY lower(t), "created_at";--> statement-breakpoint
INSERT INTO "contact_role_links" ("contact_id", "role_id")
SELECT c."id", r."id" FROM "contacts" c
JOIN "contact_roles" r ON lower(r."name") = lower(regexp_replace(btrim(c."job_title"), '\s+', ' ', 'g'))
WHERE c."job_title" IS NOT NULL AND btrim(c."job_title") <> '';--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "job_title";