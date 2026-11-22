-- Q-12: sections written before M11 are plain text and open unchanged as plain paragraphs; everything saved from now on is formatted text.
ALTER TABLE "rfp_sections" ADD COLUMN "body_format" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "rfp_sections" ALTER COLUMN "body_format" SET DEFAULT 'markdown';--> statement-breakpoint
ALTER TABLE "rfp_sections" ADD CONSTRAINT "rfp_sections_format_check" CHECK ("rfp_sections"."body_format" in ('plain', 'markdown'));
