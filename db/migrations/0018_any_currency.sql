CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"units_per_eur_e4" integer NOT NULL,
	"rate_set_at" timestamp with time zone,
	"rate_set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "currencies_code_check" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_rate_check" CHECK ("currencies"."units_per_eur_e4" > 0),
	CONSTRAINT "currencies_euro_is_one" CHECK ("currencies"."code" <> 'EUR' or "currencies"."units_per_eur_e4" = 10000)
);
--> statement-breakpoint
-- The starting list (M-8), with rough rates: how many of each currency one euro buys, times 10,000.
INSERT INTO "currencies" ("code", "name", "units_per_eur_e4", "created_by", "updated_by") VALUES
  ('EUR', 'Euro', 10000, 'migration', 'migration'),
  ('GBP', 'Pound sterling', 8550, 'migration', 'migration'),
  ('USD', 'US dollar', 10800, 'migration', 'migration'),
  ('SEK', 'Swedish krona', 115000, 'migration', 'migration'),
  ('NOK', 'Norwegian krone', 117000, 'migration', 'migration'),
  ('DKK', 'Danish krone', 74600, 'migration', 'migration');--> statement-breakpoint
-- A pound rate an admin saved (1 GBP = so many euros) is kept, turned round to 1 EUR = so many pounds, with who saved it and when.
UPDATE "currencies" SET "units_per_eur_e4" = round(100000000.0 / s."gbp_to_eur_e4")::integer, "rate_set_at" = s."updated_at", "rate_set_by" = s."updated_by", "updated_at" = s."updated_at", "updated_by" = s."updated_by"
FROM "settings" s WHERE "currencies"."code" = 'GBP' AND s."gbp_to_eur_e4" > 0;--> statement-breakpoint
-- A briefing keeps its figures (B-1): its spend total takes the new shape, with the pound rate it was converted at.
UPDATE "briefings" SET "facts" = jsonb_set(
  jsonb_set("facts", '{spend,total}', jsonb_build_object(
    'amounts', jsonb_strip_nulls(jsonb_build_object('EUR', nullif(("facts" #>> '{spend,total,EUR}')::bigint, 0), 'GBP', nullif(("facts" #>> '{spend,total,GBP}')::bigint, 0))),
    'eurMinor', coalesce(("facts" #>> '{spend,total,eurMinor}')::bigint, 0))),
  '{spend,rates}',
  CASE WHEN coalesce(("facts" #>> '{spend,total,GBP}')::bigint, 0) <> 0
    THEN jsonb_build_array(jsonb_build_object('code', 'GBP', 'unitsPerEurE4', g."units_per_eur_e4", 'starting', g."rate_set_at" IS NULL))
    ELSE '[]'::jsonb END)
FROM (SELECT "units_per_eur_e4", "rate_set_at" FROM "currencies" WHERE "code" = 'GBP') g
WHERE "facts" #> '{spend,total,amounts}' IS NULL AND "facts" #> '{spend,total}' IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_rate_check";--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "gbp_to_eur_e4";