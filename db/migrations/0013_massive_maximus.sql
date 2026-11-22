ALTER TABLE "vendors" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "vat_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_vat_unique" ON "vendors" USING btree ("vat_number") WHERE "vendors"."vat_number" is not null;