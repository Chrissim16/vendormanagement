# Vendor Management System

Internal tool for one company to track its vendors, contracts and renewals, vendor
performance and spend. Runs as a Databricks App with Entra ID sign-in.

The owner is a non-developer who directs the work and reviews outcomes. Agents write all
the code. Write everything addressed to the owner (summaries, questions, `docs/plan/progress.md`)
in plain language, with no code or jargon they would have to look up.

## Where things are

| Need | File |
|---|---|
| What we are building and why | `docs/product/brief.md` |
| Requirements with acceptance criteria | `docs/product/requirements.md` |
| Entities, fields, business rules | `docs/product/domain-model.md` |
| Stack, structure, conventions | `docs/architecture/overview.md` |
| Why a technical choice was made | `docs/architecture/decisions/` |
| Milestones and their done criteria | `docs/plan/implementation-plan.md` |
| Current status, what happened last | `docs/plan/progress.md` |
| Unanswered questions and working assumptions | `docs/open-questions.md` |

Read `progress.md` first in every session. Read the other files when the task touches them.

## How work happens

- Work is done one milestone at a time through the `/next-milestone` skill. It defines the
  build, verify, review and report loop. Follow it rather than improvising a process.
- Requirements come first. If the owner asks for something that is not in
  `requirements.md`, use `/change-request` to write it down before building it.
- The docs are the source of truth. When code and docs disagree, fix whichever is wrong in
  the same commit. Never leave them out of step.
- A milestone is done only when `npm run check` passes and the `acceptance-tester` agent has
  confirmed every acceptance criterion in the running app. Passing unit tests alone is not done.
- Keep going without asking for approval between slices. Stop and ask only when an answer
  would change the data model or scope, or when something needs the owner's access
  (Databricks workspace, credentials). Otherwise pick the assumption, record it in
  `docs/open-questions.md`, and continue.

## Rules that are easy to get wrong

- Databricks AppKit is a v0 SDK and changes quickly. Before using an AppKit or Databricks
  Apps API, check the current docs (use the `databricks-researcher` agent) instead of
  relying on memory.
- The signed-in user comes from the `X-Forwarded-Email` header, which only exists when
  deployed. Local development uses the `DEV_USER_EMAIL` variable. Never trust a user
  identity sent in a request body or query string.
- Every write checks the user's role on the server. Hiding a button is not access control.
- Every create, update and delete of a business record writes an audit log entry in the
  same database transaction.
- Money is stored as integer minor units plus an ISO currency code. Never use floats.
- Dates without a time (contract start and end, invoice date) are stored as dates, not timestamps.
- Schema changes go through migration files. Never edit a migration that has been committed.
- No secrets in the repository. Configuration comes from environment variables listed in `.env.example`.

## Commands

These exist from milestone M0 onwards. Update this list if they change.

- `npm run dev` starts the app locally against the local Postgres database
- `npm run check` runs typecheck, lint, unit tests and end-to-end tests; must pass before any commit
- `npm run db:migrate` applies migrations; `npm run db:seed` loads sample data
