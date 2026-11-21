# Implementation plan

Milestones are built in order with `/next-milestone`. Each one ends with something the
owner can click through. A milestone is done when all of these hold:

1. Every listed requirement's acceptance criteria pass in the running app, confirmed by the `acceptance-tester` agent.
2. `npm run check` passes.
3. The `code-reviewer` agent's findings are fixed or recorded as follow-ups in `progress.md`.
4. Docs match the code, and `progress.md` has a plain-language entry.
5. The work is committed and pushed.

| # | Milestone | Requirements | Depends on |
|---|---|---|---|
| M0 | Foundation | F-1, F-2, F-3 | none |
| M1 | Vendor register | V-1 to V-6 | M0 |
| M2 | Contracts and renewals | C-1 to C-7 | M1 |
| M3 | Spend | S-1 to S-5 | M1 |
| M4 | Performance | P-1 to P-3 | M1 |
| M5 | Dashboard and polish | D-1, D-2, X-1 to X-4 audit | M2, M3, M4 |
| M6 | Deploy to Databricks | none new | M0; needs the owner |

X-1 to X-4 apply to every milestone; M5 re-checks them across the whole app.

## M0 Foundation
Goal: an empty but real app that knows who you are, and a workflow that proves its own work.

- Check current Databricks Apps and AppKit docs; scaffold with `databricks apps init` (or by hand to the same layout if the CLI is unavailable) and update `architecture/overview.md` to the actual layout.
- Local Postgres, Drizzle, first migration: users, categories, audit log.
- Auth middleware, roles, `requireRole`, bootstrap admin, user admin page.
- Audit helper and audit log page.
- App shell: navigation for all future sections, header with user and role, empty-state pattern, error pattern, form pattern, data-table pattern with URL-held filters. These patterns are reused by every later milestone, so build them properly once.
- `npm run check` wired up: typecheck, lint, Vitest, Playwright with an accessibility check. CI workflow running it on every push.
- Seed script with realistic sample data, extended by each later milestone.
- `.env.example`, and commands in `CLAUDE.md` confirmed.

## M1 Vendor register
Vendors, contacts, document links, categories, list with search, filter, sort and CSV export, vendor page with history. Status rules that depend on contracts are completed in M2.

## M2 Contracts and renewals
Contracts, derived notice deadline and renewal state as tested pure functions, contract list, renewal view, renewal decisions with roll-forward, header counter, CSV export. Completes V-4.

## M3 Spend
Manual entries, CSV and Excel upload with preview and validation, upload history and revert, per-vendor and overview spend views, CSV export. Can be built in parallel with M4 once M2 is done; they touch different features.

## M4 Performance
Criteria admin, scorecards with draft and final states, vendor score and trend, performance overview.

## M5 Dashboard and polish
Home dashboard, data quality panel, load test with the volumes in D-2, full accessibility and keyboard pass, consistency pass over empty states, errors and date formats.

## M6 Deploy to Databricks
Needs answers to Q2 and Q3 in `open-questions.md` and a person with workspace access.

- Create the Lakebase database and the app; attach the database as a resource.
- `app.yaml` with configuration; run migrations against Lakebase.
- Deploy, sign in with Entra ID, confirm F-1 with the real identity header.
- Write `docs/runbook.md`: how to deploy, roll back, back up, and add an admin.

M6 can be pulled forward to straight after M0 as soon as workspace access is available.
Deploying early is preferred, because it surfaces platform surprises while the app is small.

## After version 1
Candidates, not commitments: vendor onboarding and approval, risk and due diligence,
email reminders, finance system link, currency conversion, document storage.
