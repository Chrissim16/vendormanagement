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
    /** A document belongs to an agreement, or (M6) to a candidate's response in an RFP; never to both. */
    agreementId: uuid("agreement_id").references(() => agreements.id),
    rfpCandidateId: uuid("rfp_candidate_id").references((): AnyPgColumn => rfpCandidates.id),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    extractedText: text("extracted_text"),
    /** E-1: the AI's current reading of this document's fields, when it has been asked for one. Earlier readings stay as suggestion rows. */
    readingSuggestionId: uuid("reading_suggestion_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("documents_agreement_idx").on(t.agreementId),
    index("documents_candidate_idx").on(t.rfpCandidateId),
    check("documents_owner_check", sql`(${t.agreementId} is null) <> (${t.rfpCandidateId} is null)`),
  ],
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

/** Which Jira board holds a vendor's helpdesk tickets, and how escalation is read from it (J-1). */
export const jiraBoardLinks = pgTable(
  "jira_board_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    projectKey: text("project_key").notNull(),
    projectName: text("project_name"),
    serviceDeskId: text("service_desk_id"),
    escalationMethod: text("escalation_method", { enum: ["status", "label"] }).notNull(),
    /** Statuses or labels that mean each support level. Stored trimmed; compared ignoring case. */
    l1Values: text("l1_values")
      .array()
      .notNull()
      .default(sql`'{}'`),
    l2Values: text("l2_values")
      .array()
      .notNull()
      .default(sql`'{}'`),
    l3Values: text("l3_values")
      .array()
      .notNull()
      .default(sql`'{}'`),
    active: boolean("active").notNull().default(true),
    /** When tickets were last fetched successfully: the next sync asks Jira for changes since then. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** The last attempt, successful or not, and what came of it. */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSyncOk: boolean("last_sync_ok"),
    lastSyncMessage: text("last_sync_message"),
    lastSyncUpdated: integer("last_sync_updated"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("jira_links_one_per_vendor").on(t.vendorId),
    uniqueIndex("jira_links_one_per_board").on(sql`upper(${t.projectKey})`),
    check("jira_links_method_check", sql`${t.escalationMethod} in ('status', 'label')`),
  ],
);

/** A copy of a Jira ticket, overwritten at each sync. Times are Jira's own, not when the copy was made. */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardLinkId: uuid("board_link_id")
      .notNull()
      .references(() => jiraBoardLinks.id),
    key: text("key").notNull(),
    summary: text("summary"),
    description: text("description"),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    /** Null while Jira has no outcome for the SLA (not answered yet and still in time, or no SLA on the ticket). */
    firstResponseBreached: boolean("first_response_breached"),
    resolutionBreached: boolean("resolution_breached"),
    highestLevel: integer("highest_level").notNull().default(1),
    csat: integer("csat"),
    csatAt: timestamp("csat_at", { withTimezone: true }),
    /** Every status and label the ticket has carried, lower case, so the level can be worked out again when the link's values change. */
    statusesSeen: text("statuses_seen")
      .array()
      .notNull()
      .default(sql`'{}'`),
    labelsSeen: text("labels_seen")
      .array()
      .notNull()
      .default(sql`'{}'`),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_key_per_board").on(t.boardLinkId, t.key),
    index("tickets_created_idx").on(t.boardLinkId, t.createdAt),
    index("tickets_resolved_idx").on(t.boardLinkId, t.resolvedAt),
    index("tickets_csat_idx").on(t.boardLinkId, t.csatAt),
    check("tickets_level_check", sql`${t.highestLevel} in (1, 2, 3)`),
    check("tickets_csat_check", sql`${t.csat} is null or ${t.csat} between 1 and 5`),
  ],
);

/** A vendor's contractual target for one metric, in tenths (95% is 950, 4.2 stars is 42, 30 days is 300). */
export const performanceTargets = pgTable(
  "performance_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    metric: text("metric", { enum: ["first_response", "first_line", "sla_breaches", "backlog_age", "csat"] }).notNull(),
    targetTenths: integer("target_tenths").notNull(),
    ...stamps,
  },
  (t) => [
    uniqueIndex("targets_one_per_metric").on(t.vendorId, t.metric),
    check("targets_metric_check", sql`${t.metric} in ('first_response', 'first_line', 'sla_breaches', 'backlog_age', 'csat')`),
    check("targets_value_check", sql`${t.targetTenths} >= 0`),
  ],
);

/** What a vendor is scored on (P-7). `metrics` names the helpdesk figures a measured criterion is judged from. */
export const scorecardCriteria = pgTable(
  "scorecard_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    /** Relative weight in the overall score, 1 to 100. */
    weight: integer("weight").notNull(),
    source: text("source", { enum: ["measured", "manual"] }).notNull(),
    metrics: text("metrics")
      .array()
      .notNull()
      .default(sql`'{}'`),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...stamps,
  },
  (t) => [
    uniqueIndex("criteria_name_unique").on(sql`lower(${t.name})`),
    check("criteria_source_check", sql`${t.source} in ('measured', 'manual')`),
    check("criteria_weight_check", sql`${t.weight} between 1 and 100`),
  ],
);

/** Everything the AI has produced, and what a person did with it (AI-1). The output is kept exactly as the model gave it. */
export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputSummary: text("input_summary"),
    output: jsonb("output").notNull(),
    status: text("status", { enum: ["proposed", "accepted", "edited", "rejected"] })
      .notNull()
      .default("proposed"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_suggestions_subject_idx").on(t.subjectType, t.subjectId),
    check("ai_suggestions_status_check", sql`${t.status} in ('proposed', 'accepted', 'edited', 'rejected')`),
  ],
);

/**
 * The AI's proposal for one vendor and month (P-1): a score per measured criterion and the
 * ticket themes. `scores` holds the scores as they stand after a person's review; the
 * model's own answer stays in the suggestion.
 */
export const monthlyProposals = pgTable(
  "monthly_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    month: text("month").notNull(),
    suggestionId: uuid("suggestion_id")
      .notNull()
      .references(() => aiSuggestions.id),
    scores: jsonb("scores").notNull(),
    themes: jsonb("themes").notNull(),
    /** How many of the month's tickets the model was given to read. */
    ticketsRead: integer("tickets_read").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("proposals_one_per_month").on(t.vendorId, t.month), check("proposals_month_check", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
);

/** A vendor's scorecard for one quarter (P-2 to P-4). `snapshot` is filled when it is finalised and makes a final scorecard independent of later changes. */
export const scorecards = pgTable(
  "scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["draft", "final"] })
      .notNull()
      .default("draft"),
    summary: text("summary"),
    finalisedAt: timestamp("finalised_at", { withTimezone: true }),
    finalisedBy: text("finalised_by"),
    snapshot: jsonb("snapshot"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("scorecards_one_per_quarter").on(t.vendorId, t.periodStart),
    check("scorecards_status_check", sql`${t.status} in ('draft', 'final')`),
    check("scorecards_period_check", sql`${t.periodEnd} > ${t.periodStart}`),
    // A final scorecard without its frozen copy would silently show today's figures (P-7).
    check("scorecards_final_check", sql`${t.status} <> 'final' or ${t.snapshot} is not null`),
  ],
);

export const scorecardLines = pgTable(
  "scorecard_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scorecardId: uuid("scorecard_id")
      .notNull()
      .references(() => scorecards.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => scorecardCriteria.id),
    score: integer("score"),
    vendorComment: text("vendor_comment"),
    internalNote: text("internal_note"),
    /** What the AI suggested when the reviewer scored, and whether the reviewer took it as it was (AI-1). */
    suggestedScore: integer("suggested_score"),
    acceptedSuggestion: boolean("accepted_suggestion").notNull().default(false),
    ...stamps,
  },
  (t) => [
    uniqueIndex("scorecard_lines_one_per_criterion").on(t.scorecardId, t.criterionId),
    check("scorecard_lines_score_check", sql`${t.score} is null or ${t.score} between 1 and 5`),
  ],
);

/**
 * A vendor briefing (B-1): the facts about a vendor as the app held them on one day,
 * frozen in `facts`, plus the summary and talking points as a person left them. The AI's
 * own text stays in the suggestion and counts for nothing until a person takes it over.
 */
export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    asAt: date("as_at", { mode: "string" }).notNull(),
    facts: jsonb("facts").notNull(),
    summary: text("summary"),
    /** One talking point per line. */
    talkingPoints: text("talking_points"),
    suggestionId: uuid("suggestion_id").references(() => aiSuggestions.id),
    ...stamps,
  },
  (t) => [index("briefings_vendor_idx").on(t.vendorId, t.createdAt)],
);

/** The summary paragraph of a month's management report (D-2), as a person left it. The figures are worked out when the report is made. */
export const managementReports = pgTable(
  "management_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: text("month").notNull(),
    summary: text("summary"),
    /** A fingerprint of the month's figures as they were when the summary was saved, to tell when the summary has fallen behind them. */
    summaryFigures: text("summary_figures"),
    suggestionId: uuid("suggestion_id").references(() => aiSuggestions.id),
    ...stamps,
  },
  (t) => [uniqueIndex("management_reports_month_unique").on(t.month), check("management_reports_month_check", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
);

// ---------- RFP (M6)

export const rfpStages = ["drafting", "in_review", "approved", "issued", "evaluating", "decided", "cancelled"] as const;

/**
 * One request for proposal, from the approved demand to the decision (Q-1 to Q-11). The
 * decision is kept on the RFP itself: the winner, the day and the rationale.
 */
export const rfps = pgTable(
  "rfps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    need: text("need").notNull(),
    budgetMinor: bigint("budget_minor", { mode: "number" }),
    currency: text("currency", { enum: ["EUR", "GBP"] })
      .notNull()
      .default("EUR"),
    sponsor: text("sponsor"),
    demandApprovedOn: date("demand_approved_on", { mode: "string" }),
    targetDecisionDate: date("target_decision_date", { mode: "string" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    stage: text("stage", { enum: rfpStages }).notNull().default("drafting"),
    writtenWeight: integer("written_weight").notNull().default(70),
    demoWeight: integer("demo_weight").notNull().default(30),
    /** The AI's latest draft and its latest comparison of the answers; each counts for nothing until a person uses it. */
    draftSuggestionId: uuid("draft_suggestion_id").references(() => aiSuggestions.id),
    comparisonSuggestionId: uuid("comparison_suggestion_id").references(() => aiSuggestions.id),
    /** A fingerprint of the answers the comparison was made from, to tell when an answer has changed since. */
    comparisonAnswers: text("comparison_answers"),
    winnerCandidateId: uuid("winner_candidate_id").references((): AnyPgColumn => rfpCandidates.id),
    decidedOn: date("decided_on", { mode: "string" }),
    rationale: text("rationale"),
    cancelReason: text("cancel_reason"),
    ...stamps,
  },
  (t) => [
    index("rfps_stage_idx").on(t.stage),
    check("rfps_stage_check", sql`${t.stage} in ('drafting', 'in_review', 'approved', 'issued', 'evaluating', 'decided', 'cancelled')`),
    check("rfps_weights_check", sql`${t.writtenWeight} >= 0 and ${t.demoWeight} >= 0 and ${t.writtenWeight} + ${t.demoWeight} = 100`),
    check("rfps_budget_check", sql`coalesce(${t.budgetMinor}, 0) >= 0`),
    // A decided RFP without its decision would leave the trail with a hole in it.
    check("rfps_decision_check", sql`${t.stage} <> 'decided' or (${t.winnerCandidateId} is not null and ${t.decidedOn} is not null and ${t.rationale} is not null)`),
  ],
);

export const rfpCriteria = pgTable(
  "rfp_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfpId: uuid("rfp_id")
      .notNull()
      .references(() => rfps.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    weight: integer("weight").notNull(),
    part: text("part", { enum: ["written", "demo"] }).notNull(),
  },
  (t) => [
    index("rfp_criteria_rfp_idx").on(t.rfpId),
    check("rfp_criteria_part_check", sql`${t.part} in ('written', 'demo')`),
    check("rfp_criteria_weight_check", sql`${t.weight} between 1 and 100`),
  ],
);

export const rfpSections = pgTable(
  "rfp_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfpId: uuid("rfp_id")
      .notNull()
      .references(() => rfps.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    heading: text("heading").notNull(),
    body: text("body"),
  },
  (t) => [index("rfp_sections_rfp_idx").on(t.rfpId)],
);

export const rfpQuestions = pgTable(
  "rfp_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfpId: uuid("rfp_id")
      .notNull()
      .references(() => rfps.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    text: text("text").notNull(),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => rfpCriteria.id),
  },
  (t) => [uniqueIndex("rfp_questions_number_unique").on(t.rfpId, t.number)],
);

/** A reviewer's verdict on the draft (Q-3). Reviewers are often outside the team, so they are named, not linked to a user. */
export const rfpSignoffs = pgTable(
  "rfp_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfpId: uuid("rfp_id")
      .notNull()
      .references(() => rfps.id, { onDelete: "cascade" }),
    reviewerName: text("reviewer_name").notNull(),
    reviewerRole: text("reviewer_role"),
    outcome: text("outcome", { enum: ["approved", "changes_requested"] }).notNull(),
    onDate: date("on_date", { mode: "string" }).notNull(),
    comment: text("comment"),
    /** For requested changes: the day they were dealt with. Until then the request is open and blocks approval. */
    resolvedOn: date("resolved_on", { mode: "string" }),
    /** Set on an approval when the document changes afterwards: it was given for an earlier version and no longer counts. */
    superseded: boolean("superseded").notNull().default(false),
    ...stamps,
  },
  (t) => [index("rfp_signoffs_rfp_idx").on(t.rfpId), check("rfp_signoffs_outcome_check", sql`${t.outcome} in ('approved', 'changes_requested')`)],
);

export const rfpCandidates = pgTable(
  "rfp_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfpId: uuid("rfp_id")
      .notNull()
      .references(() => rfps.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    list: text("list", { enum: ["longlist", "shortlist", "dropped"] }).notNull(),
    reason: text("reason").notNull(),
    issuedOn: date("issued_on", { mode: "string" }),
    /** Who went ahead with issuing although no NDA was in place (Q-5). */
    ndaWarningAcknowledgedBy: text("nda_warning_acknowledged_by"),
    responseReceivedOn: date("response_received_on", { mode: "string" }),
    /** Rows of an uploaded answer sheet that could not be matched to a question, kept until someone has placed or discarded them (Q-6). */
    unmatched: jsonb("unmatched").$type<{ row: number; number: string; question: string; answer: string }[]>().notNull().default([]),
    ...stamps,
  },
  (t) => [uniqueIndex("rfp_candidates_one_per_vendor").on(t.rfpId, t.vendorId), check("rfp_candidates_list_check", sql`${t.list} in ('longlist', 'shortlist', 'dropped')`)],
);

export const rfpAnswers = pgTable(
  "rfp_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => rfpCandidates.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => rfpQuestions.id),
    text: text("text").notNull(),
    ...stamps,
  },
  (t) => [uniqueIndex("rfp_answers_one_per_question").on(t.candidateId, t.questionId)],
);

/** One team member's score for one candidate on one criterion (Q-8). */
export const rfpScores = pgTable(
  "rfp_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => rfpCandidates.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => rfpCriteria.id),
    evaluatorUserId: uuid("evaluator_user_id")
      .notNull()
      .references(() => users.id),
    score: integer("score").notNull(),
    comment: text("comment"),
    /** What the AI proposed when this score was given, and from which comparison (AI-1). */
    suggestedScore: integer("suggested_score"),
    suggestionId: uuid("suggestion_id").references(() => aiSuggestions.id),
    ...stamps,
  },
  (t) => [uniqueIndex("rfp_scores_one_per_evaluator").on(t.candidateId, t.criterionId, t.evaluatorUserId), check("rfp_scores_score_check", sql`${t.score} between 1 and 5`)],
);
