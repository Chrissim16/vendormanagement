import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    displayName: text("display_name"),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    active: boolean("active").notNull().default(true),
    ...stamps,
  },
  (t) => [check("users_role_check", sql`${t.role} in ('admin', 'member')`)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userEmail: text("user_email").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary"),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    type: text("type", { enum: ["software", "consultancy", "advisory"] }).notNull(),
    status: text("status", { enum: ["prospect", "active", "on_hold", "offboarded"] })
      .notNull()
      .default("active"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    website: text("website"),
    country: text("country"),
    description: text("description"),
    notes: text("notes"),
    scoringEnabled: boolean("scoring_enabled").notNull().default(true),
    ndaRequired: boolean("nda_required").notNull().default(true),
    dpaRequired: boolean("dpa_required").notNull().default(true),
    ...stamps,
  },
  (t) => [
    // One vendor per name, ignoring case. Names are stored with extra spaces removed.
    uniqueIndex("vendors_name_unique").on(sql`lower(${t.name})`),
    check("vendors_type_check", sql`${t.type} in ('software', 'consultancy', 'advisory')`),
    check("vendors_status_check", sql`${t.status} in ('prospect', 'active', 'on_hold', 'offboarded')`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...stamps,
  },
  (t) => [
    index("contacts_vendor_idx").on(t.vendorId),
    uniqueIndex("contacts_one_primary")
      .on(t.vendorId)
      .where(sql`${t.isPrimary}`),
  ],
);

export const agreements = pgTable(
  "agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    kind: text("kind", { enum: ["msa", "sow", "subscription", "nda", "dpa"] }).notNull(),
    title: text("title").notNull(),
    reference: text("reference"),
    status: text("status", { enum: ["draft", "in_negotiation", "out_for_signature", "active", "ended"] })
      .notNull()
      .default("draft"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    currency: text("currency", { enum: ["EUR", "GBP"] })
      .notNull()
      .default("EUR"),
    signedOn: date("signed_on", { mode: "string" }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    endReason: text("end_reason", { enum: ["completed", "expired", "terminated", "replaced"] }),
    notes: text("notes"),
    // SOW
    parentMsaId: uuid("parent_msa_id").references((): AnyPgColumn => agreements.id),
    pricing: text("pricing", { enum: ["fixed", "time_and_materials"] }),
    budgetMinor: bigint("budget_minor", { mode: "number" }),
    // Subscription
    annualValueMinor: bigint("annual_value_minor", { mode: "number" }),
    noticePeriodDays: integer("notice_period_days"),
    autoRenews: boolean("auto_renews"),
    renewalTermMonths: integer("renewal_term_months"),
    ...stamps,
  },
  (t) => [
    index("agreements_vendor_idx").on(t.vendorId),
    index("agreements_end_idx").on(t.endDate),
    check("agreements_kind_check", sql`${t.kind} in ('msa', 'sow', 'subscription', 'nda', 'dpa')`),
    check("agreements_status_check", sql`${t.status} in ('draft', 'in_negotiation', 'out_for_signature', 'active', 'ended')`),
    check("agreements_dates_check", sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("agreements_money_check", sql`coalesce(${t.budgetMinor}, 0) >= 0 and coalesce(${t.annualValueMinor}, 0) >= 0`),
  ],
);

export const renewalDecisions = pgTable(
  "renewal_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    decision: text("decision", { enum: ["renew", "renegotiate", "terminate"] }).notNull(),
    decidedOn: date("decided_on", { mode: "string" }).notNull(),
    decidedBy: text("decided_by").notNull(),
    notes: text("notes"),
    /** The end date of the term this decision was made for. */
    termEndDate: date("term_end_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("decisions_one_per_term").on(t.agreementId, t.termEndDate)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    extractedText: text("extracted_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [index("documents_agreement_idx").on(t.agreementId)],
);

/** One row of admin settings. Absent until an admin first saves; the defaults apply until then. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    gbpToEurE4: integer("gbp_to_eur_e4").notNull(),
    noticeDays: integer("notice_days").notNull(),
    sowEndDays: integer("sow_end_days").notNull(),
    budgetWarningPct: integer("budget_warning_pct").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`), check("settings_rate_check", sql`${t.gbpToEurE4} > 0`)],
);

export const rateCardLines = pgTable(
  "rate_card_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    role: text("role").notNull(),
    dayRateMinor: bigint("day_rate_minor", { mode: "number" }).notNull(),
    currency: text("currency", { enum: ["EUR", "GBP"] })
      .notNull()
      .default("EUR"),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [uniqueIndex("rate_card_one_per_day").on(t.vendorId, sql`lower(${t.role})`, t.validFrom), check("rate_card_rate_check", sql`${t.dayRateMinor} > 0`)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sowId: uuid("sow_id")
      .notNull()
      .references(() => agreements.id),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["open", "delivered", "cancelled"] })
      .notNull()
      .default("open"),
    deliveredOn: date("delivered_on", { mode: "string" }),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    ...stamps,
  },
  (t) => [
    index("milestones_sow_idx").on(t.sowId),
    check("milestones_status_check", sql`${t.status} in ('open', 'delivered', 'cancelled')`),
    check("milestones_amount_check", sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
  ],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sowId: uuid("sow_id")
      .notNull()
      .references(() => agreements.id),
    title: text("title").notNull(),
    description: text("description"),
    requestedOn: date("requested_on", { mode: "string" }).notNull(),
    status: text("status", { enum: ["proposed", "approved", "rejected"] })
      .notNull()
      .default("proposed"),
    budgetChangeMinor: bigint("budget_change_minor", { mode: "number" }),
    newEndDate: date("new_end_date", { mode: "string" }),
    decidedOn: date("decided_on", { mode: "string" }),
    decidedBy: text("decided_by"),
    /** What the SOW held just before approval, so the page can show the path from original to current. */
    budgetBeforeMinor: bigint("budget_before_minor", { mode: "number" }),
    endDateBefore: date("end_date_before", { mode: "string" }),
    ...stamps,
  },
  (t) => [index("change_requests_sow_idx").on(t.sowId), check("change_requests_status_check", sql`${t.status} in ('proposed', 'approved', 'rejected')`)],
);

export const consultants = pgTable(
  "consultants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sowId: uuid("sow_id")
      .notNull()
      .references(() => agreements.id),
    name: text("name").notNull(),
    role: text("role").notNull(),
    fromDate: date("from_date", { mode: "string" }),
    toDate: date("to_date", { mode: "string" }),
    ...stamps,
  },
  (t) => [index("consultants_sow_idx").on(t.sowId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    milestoneId: uuid("milestone_id").references(() => milestones.id),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency", { enum: ["EUR", "GBP"] }).notNull(),
    description: text("description"),
    ...stamps,
  },
  (t) => [
    // One invoice number per vendor, ignoring case.
    uniqueIndex("invoices_number_per_vendor").on(t.vendorId, sql`lower(${t.invoiceNumber})`),
    index("invoices_agreement_idx").on(t.agreementId),
    index("invoices_date_idx").on(t.invoiceDate),
    check("invoices_amount_check", sql`${t.amountMinor} > 0`),
  ],
);
