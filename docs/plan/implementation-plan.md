# Implementation plan

Milestones are built in order with `/next-milestone`. Each ends with something the owner
can click through. A milestone is done when:

1. Every listed requirement's acceptance criteria pass in the running app, confirmed by the `acceptance-tester` agent.
2. `npm run check` passes.
3. The `code-reviewer` agent's findings are fixed or recorded as follow-ups in `progress.md`.
4. Docs match the code, and `progress.md` has a plain-language entry.
5. The work is committed and pushed.

| # | Milestone | Requirements | Depends on |
|---|---|---|---|
| M0 | Foundation | F-1 to F-4 | none |
| M1 | Vendors and agreements | V-1 to V-4, A-1 to A-8 | M0 |
| M2 | SOW delivery and money | M-1 to M-7 | M1 |
| M3 | Performance from Jira | J-1 to J-5 | M1 |
| M4 | Scorecards and AI scoring | P-1 to P-7, AI-1, AI-2 | M2, M3 |
| M5 | Briefings, risk flags, dashboard, report | B-1, R-1, D-1, D-2 | M4 |
| M6 | RFP | Q-1 to Q-11 | M1; AI from M4 |
| M7 | Ask a question | C-1 | M5, M6 |
| M8 | Contract reading | E-1 | M1; AI from M4 |
| M10 | Vendor details, contact roles, history tabs | V-5 to V-7; changes to F-3 and Q-11 | M8 |
| M11 | RFP editor, review rounds, company template | Q-12 to Q-14; change to Q-3 | M10 |
| M12 | Any currency | M-8; changes to M-6, M-7, C-1 and E-1 | M11 |
| M9 | Move to Databricks | none new | all; needs the owner at work |

M10, M11 and M12 were asked for after M8 was done (22 Nov 2026) and are built before M9, so the move to Databricks starts with the final database layout.

X-1 to X-6 apply to every milestone. M2 and M3 touch different features and may be built in parallel.

## M0 Foundation
- Check current Databricks Apps and AppKit docs, scaffold the app, update `architecture/overview.md` to the real layout.
- The five ports with their local implementations and contract tests. Deployed implementations are written here too, from documentation, and marked unproven.
- Database, migrations, users, roles, audit.
- Design tokens and motion presets from `docs/design/design-guide.md`, matching `docs/design/prototype.html`. Settle the AppKit component question noted there.
- App shell with navigation for every section, and the reusable patterns: data table with URL-held filters, list with side panel, empty state, error state, record history.
- Moved to M1, where the first screens need them: the form pattern (with X-3, keeping what was typed after a failed save), file upload and PDF export.
- System check page.
- `npm run check`, CI on every push, seed script with invented data, `.env.example`.

## M1 Vendors and agreements
Starts with the patterns moved from M0: the form pattern with field errors and kept input, the dialog, tabs and file upload. The PDF helper moves on to M4, the first milestone that produces a PDF.
Vendors, contacts, the five agreement kinds with status, MSA to SOW structure, documents, subscriptions with renewals and decisions, warnings page and header count, Excel import.

## M2 SOW delivery and money
Milestones, change requests with history, consultants and rate cards, invoices, budget view and budget warning, spend overview, exchange rate.

## M3 Performance from Jira
Fake Jira that mimics the Jira Cloud and Jira Service Management API shape, with invented tickets across several boards, including boards that escalate by status and by label. Board links, sync job, monthly metrics with drill-down, targets, performance overview.
Before building, the `databricks-researcher` agent confirms the current Jira Service Management API fields for SLA results and satisfaction ratings.

## M4 Scorecards and AI scoring
The PDF helper (`pdfkit`). The `server/ai` layer with suggestion records, prompt versioning and evaluation sets. Monthly proposals, ticket themes, quarterly scorecards, manual scorecards, vendor PDF, criteria admin.

## M5 Briefings, risk flags, dashboard, report
Vendor briefing with PDF, risk flag rules as tested pure functions, dashboard, monthly management report PDF.

## M6 RFP
Demand, AI draft, review sign-offs, candidates, Word and Excel export, response upload and matching, AI comparison, multi-evaluator scoring, decision, decision record PDF.

## M7 Ask a question
Read-only query tools over the existing list queries, document text search, chat screen with source links.

## M8 Contract reading
Field proposal from an uploaded document with source passages and confirm step.

## M10 Vendor details, contact roles, history tabs
Address and VAT or tax number on the vendor, a main contact on the new-vendor form, a shared list of contact roles in place of the job title, and the history out of the way of long pages.

Reworks what was built: the vendor form, panel and page; the contact form; the import template and its checks; Ask's vendor look-up; the sample data (invented addresses, VAT numbers and roles); the RFP page, which gets a History tab after Decision; the agreement, scorecard and briefing pages, where the history shows the newest five entries with "Show all". A migration turns each job title into a role.

## M11 RFP editor, review rounds, company template
A formatting editor for RFP sections, the AI rewriting a section on request, review rounds with a version number, reading comments and tracked changes back from returned Word files, and the company's Word template uploaded by an admin.

Reworks what was built: the Document and Review tabs, the AI draft prompt (formatted output), the Word export for review and for candidates, the decision record PDF (formatted sections), and the review PDF, which is removed. The editor is a new pattern and goes into the design guide. The `docx` package's handling of an existing template, and reading comments and tracked changes from a Word file, are checked against current documentation before building. An invented example template is made for trying the app.

## M12 Any currency
Replaces the single pound rate with a currency list (M-8): euro as the main currency, GBP, USD, SEK, NOK and DKK to start with, others added by an admin.

Reworks what was built:
- Database: a currencies table; every currency field (agreements, rate card lines, invoices, RFPs) refers to it instead of allowing only EUR and GBP; the pound rate moves out of settings, turned round to "1 EUR = X". One new migration.
- Shared money code: amounts read, shown and totalled for any listed currency; one way of converting to euros used everywhere.
- Settings page: the currency list with rates, adding and removing currencies, the starting-rate notice.
- Money page and its exports, invoice list totals: euro total first, the amounts per currency beneath it.
- Dashboard, monthly report and its PDF, briefing and its PDF, and the AI prompts that receive these figures.
- Agreement, rate card, RFP and import forms (including the import template M10 extended): choose from the list.
- Ask: totals per currency, and the figure check for every currency sign and code.
- Contract reading: recognising amounts in every listed currency, and leaving "kr" alone out.
- Sample data: a few vendors invoicing in USD, SEK, NOK and DKK, so the Money page shows the mix.
- Tests and the acceptance checks for M-6, M-7, M-8, C-1 and E-1.

## M9 Move to Databricks
Done at work, with limited AI assistance, so the preparation is done here first.

Prepared before the move:
- `docs/runbook.md`: step-by-step deployment for a non-developer, with what each step should show when it worked.
- `app.yaml`, resource definitions, a first-run script that migrates the database.
- A final full run of `npm run check` and the acceptance tester over all milestones.

At work:
1. Download the repository from GitHub.
2. Create the app, the Lakebase database and the volume; grant app access to the VS Finance team only.
3. Set the Jira service account and the model serving endpoint as app resources.
4. Deploy and open the system check page. Fix whatever it reports.
5. Upload the company's Word template on the settings page, with [Title], [Date] and [Version] typed on its cover page, and check one RFP review copy in Word.
6. Link the real Jira boards, run the first sync, compare a month's metrics with Jira's own reports.
6. Enter real vendors and agreements with the Excel import.

Recommended: do steps 1 to 4 once straight after M0, with the empty app. It costs little,
and it proves sign-in, database and deployment while there is almost nothing to go wrong.

## Backlog after version 1
Service credit calculation; in-app review for people outside the team; email or Teams
warnings; unusual-clause detection in contract text; award and rejection letters.
