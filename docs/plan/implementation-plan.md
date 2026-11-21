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
| M9 | Move to Databricks | none new | all; needs the owner at work |

X-1 to X-6 apply to every milestone. M2 and M3 touch different features and may be built in parallel.

## M0 Foundation
- Check current Databricks Apps and AppKit docs, scaffold the app, update `architecture/overview.md` to the real layout.
- The five ports with their local implementations and contract tests. Deployed implementations are written here too, from documentation, and marked unproven.
- Database, migrations, users, roles, audit.
- Design tokens and motion presets from `docs/design/design-guide.md`, matching `docs/design/prototype.html`. Settle the AppKit component question noted there.
- App shell with navigation for every section, and the reusable patterns: form, data table with URL-held filters, empty state, error state, file upload, PDF export.
- System check page.
- `npm run check`, CI on every push, seed script with invented data, `.env.example`.

## M1 Vendors and agreements
Vendors, contacts, the five agreement kinds with status, MSA to SOW structure, documents, subscriptions with renewals and decisions, warnings page and header count, Excel import.

## M2 SOW delivery and money
Milestones, change requests with history, consultants and rate cards, invoices, budget view and budget warning, spend overview, exchange rate.

## M3 Performance from Jira
Fake Jira that mimics the Jira Cloud and Jira Service Management API shape, with invented tickets across several boards, including boards that escalate by status and by label. Board links, sync job, monthly metrics with drill-down, targets, performance overview.
Before building, the `databricks-researcher` agent confirms the current Jira Service Management API fields for SLA results and satisfaction ratings.

## M4 Scorecards and AI scoring
The `server/ai` layer with suggestion records, prompt versioning and evaluation sets. Monthly proposals, ticket themes, quarterly scorecards, manual scorecards, vendor PDF, criteria admin.

## M5 Briefings, risk flags, dashboard, report
Vendor briefing with PDF, risk flag rules as tested pure functions, dashboard, monthly management report PDF.

## M6 RFP
Demand, AI draft, review sign-offs, candidates, Word and Excel export, response upload and matching, AI comparison, multi-evaluator scoring, decision, decision record PDF.

## M7 Ask a question
Read-only query tools over the existing list queries, document text search, chat screen with source links.

## M8 Contract reading
Field proposal from an uploaded document with source passages and confirm step.

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
5. Link the real Jira boards, run the first sync, compare a month's metrics with Jira's own reports.
6. Enter real vendors and agreements with the Excel import.

Recommended: do steps 1 to 4 once straight after M0, with the empty app. It costs little,
and it proves sign-in, database and deployment while there is almost nothing to go wrong.

## Backlog after version 1
Service credit calculation; in-app review for people outside the team; email or Teams
warnings; unusual-clause detection in contract text; award and rejection letters.
