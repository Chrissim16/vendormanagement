# Vendor Management System

Vendor and contract management for one finance IT team of at most five people: vendors,
agreements (MSA, SOW, subscription, NDA, DPA), SOW budgets and invoices, helpdesk
performance from Jira, AI-proposed scorecards and briefings, and a guided RFP process.

It is built here, outside the company, and later moved to the company's Databricks
workspace (Databricks App, Entra ID sign-in, Lakebase, model serving, Jira Cloud). None of
those company services can be reached from this repository's build environment.

The owner is a non-developer who directs the work and reviews outcomes. Agents write all
the code. Write everything addressed to the owner (summaries, questions, `docs/plan/progress.md`)
in plain language, with no code or jargon they would have to look up.

## Where things are

| Need | File |
|---|---|
| What we are building and why (the PRD) | `docs/product/prd.md` |
| Requirements with acceptance criteria | `docs/product/requirements.md` |
| Entities, fields, business rules | `docs/product/domain-model.md` |
| Stack, structure, conventions | `docs/architecture/overview.md` |
| Look, feel, motion, UI libraries | `docs/design/design-guide.md` and `docs/design/prototype.html` |
| Why a technical choice was made | `docs/architecture/decisions/` |
| Milestones and their done criteria | `docs/plan/implementation-plan.md` |
| Current status, what happened last | `docs/plan/progress.md` |
| Unanswered questions and working assumptions | `docs/open-questions.md` |
| How the owner tries the app on their own computer | `docs/try-it.md` |
| Moving the app into Databricks (M9): the owner's guide, and the instructions for the AI in Cursor that does it | `docs/runbook.md`, `docs/deploy-with-cursor.md` |

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

- Databricks, Lakebase and Jira cannot be reached from here. Before writing code against
  one of them, check the current docs with the `databricks-researcher` agent, and mark
  the code UNPROVEN until it has run in the workspace.
- The signed-in user comes from the `X-Forwarded-Email` header, which only exists when
  deployed. Local development uses the `DEV_USER_EMAIL` variable. Never trust a user
  identity sent in a request body or query string.
- Anything that only exists inside the company (identity, database, file storage, Jira, AI
  model) is used through its port in `server/platform/ports/`. Feature code never imports
  an implementation, and a new port method needs a contract test both implementations pass.
- No real company data in this repository, ever: no real vendor names, people, amounts or
  tickets. Sample data is invented. If the owner pastes real data into a session, do not
  write it to a file.
- AI suggests, people decide. Every model call goes through `server/ai` and is stored as a
  suggestion that a person accepts or edits. Numbers shown as facts are computed in code,
  not by the model. Chat is read-only: Ask answers only from the look-ups in
  `shared/ask.ts`, each of which reuses a list page's own query. A new look-up must read
  only, and a figure Ask can quote must be one a page shows for the same filter.
- Admin-only endpoints check the role on the server. Hiding a button is not access control.
- Every create, update and delete of a business record writes an audit log entry in the
  same database transaction.
- Every screen follows the design guide. Build new screens from the shared patterns; if a
  screen needs something the guide does not cover, add it to the guide in the same change.
- Money is stored as integer minor units plus an ISO currency code. Never use floats.
- Dates without a time (contract start and end, invoice date) are stored as dates, not timestamps.
- Schema changes go through migration files. Never edit a migration that has been committed.
- No secrets in the repository. Configuration comes from environment variables listed in `.env.example`.

## Commands

- `npm run try` starts the app with the invented sample data, fresh every time, for the owner to try on their own computer (see `docs/try-it.md`)
- `npm run dev` starts the app locally (server on 3000, screens on http://localhost:5173) with a built-in database in `.data/`; no install beyond `npm install`
- `npm run check` runs typecheck, lint, server tests, build and browser tests; must pass before any commit
- `npm run db:seed` loads the invented sample data; `npm run db:generate` creates a migration after a schema change (migrations apply themselves at start)
- `npm run job -- jira-sync` fetches every linked board's tickets from Jira once; the running app also does this by itself every hour
- `npm run job -- monthly-proposals` asks the AI for last month's proposal for every helpdesk vendor that has none; the running app also does this by itself
- `npm run job -- document-text` reads the text of documents attached before the app could read them, so Ask can search them; the app also does this by itself at start
- `npm run ai:eval` runs the prompt evaluation sets (against a real model when one is configured, otherwise the stand-in)
- Locally, `POST /api/dev/ai` with `{"mode": "unavailable"}` (or `"nonsense"`, `"working"`) makes the stand-in AI fail, to see what a page does then
- `npx vitest run <path>` and `npx playwright test -g "<requirement ID>" --trace off` run part of the tests
- Sign in locally as someone else with the "Viewing as" menu, or the `dev_user` cookie in tests
