# Architecture overview

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, strict mode |
| Platform | Databricks Apps (Node.js runtime) |
| App framework | Express server plus React client built with Vite. Databricks' `@databricks/lakebase` helper for the database connection; the rest of AppKit is not used (decision 0001) |
| Database | Lakebase (managed Postgres) when deployed. Locally, Postgres built into the app (PGlite) so nothing needs installing, or a Postgres server through `DATABASE_URL` |
| Data access | Drizzle ORM with SQL migration files |
| Validation | Zod schemas shared by server and client |
| UI | React, shadcn/ui on Radix, Tailwind CSS, Motion, TanStack Query and Table, Recharts; see `docs/design/design-guide.md` |
| Documents out | Word (`docx`), Excel (`exceljs`), PDF with `pdfkit`. No browser is available on the platform, so PDFs are drawn directly, not rendered from HTML |
| Tests | Vitest for unit and API tests, Playwright for end-to-end tests |
| Build | Vite for the screens, esbuild to bundle the server into `dist/server/main.js` |
| Checks | ESLint, Prettier, `tsc --noEmit`, all behind `npm run check` |

Reasons are in `decisions/`.

## Ports: the five things that differ between here and Databricks

The app is built outside the company and moved in later (decision 0004). Everything that
only exists inside the company sits behind an interface in `server/platform/ports/`, with
two implementations chosen by configuration.

| Port | Local and test implementation | Deployed implementation |
|---|---|---|
| Identity | `DEV_USER_EMAIL`, or the `dev_user` cookie or `x-dev-user` header to act as someone else; `/api/dev/*` lists and switches people. Only on this machine | `X-Forwarded-Email` from the Databricks Apps proxy, and nothing else |
| Database | Built-in Postgres in `.data/pg` (in memory for tests), or `DATABASE_URL` | Lakebase app resource |
| File storage | Folder on disk | Unity Catalog volume |
| Jira | A pretend Jira site with invented boards and tickets, answering the REST paths the app uses in Jira Cloud's own JSON shapes | Jira Cloud REST API with a service account |
| AI model | A rule-based stand-in that answers the app's prompts in the shape a real model is asked for, and can be switched to "unavailable" or "nonsense" (`POST /api/dev/ai`) to try failures; optionally a real model through an API key, for the evaluation sets only | Databricks model serving endpoint |

Rules:
- Feature code depends on the port interface only, never on an implementation.
- Each port has a contract test suite that both implementations must pass. The deployed implementations' contract tests can be run from the system check page (F-4).
- No Databricks, `pg` or PGlite import outside `server/platform`. ESLint enforces this.
- Deployed implementations are written from documentation and marked UNPROVEN in the code until the first deployment.
- The Jira port is one client on top of a small "transport" (one request to Jira). The deployed transport goes over the network; the stand-in answers the same paths from invented tickets. Reading SLAs, ratings and ticket history is therefore the same code in both, and is covered by the tests.
- The stand-in sign-in lets anyone choose who they are, so with stand-ins the app listens on its own machine only. The one exception is a sample version (F-5): with `DEMO_PASSWORD` set, `server/platform/demo.ts` puts HTTP Basic in front of everything, pages, data and files alike, and `/api/config` tells the screens to show the sample-version notice. `/healthz` answers without the password for a hosting service's check. The setting is refused on Databricks. The built-in database needs 600 to 800 MB of memory; a small host needs `DATABASE_URL` to a Postgres server instead (under 200 MB).
- Which set is used is decided by `PLATFORM` (`local` or `databricks`). The app refuses to start with stand-ins inside Databricks.

## Shape of the code

```
server/
  features/<feature>/     routes.ts, service.ts, repo.ts, schema.ts, *.test.ts
  platform/               auth, roles, audit, db, errors, config, ports/, jobs/
  ai/                     prompts/ (versioned), index.ts (ask, record, review), evals/
client/src/
  features/<feature>/     pages, components, hooks
  platform/               layout, session, shared components (ui, DataTable, SplitView, History)
  lib/                    api client, URL state, formatting, motion presets, theme
shared/                   types, Zod schemas, pure business rules
db/schema, db/migrations, db/seed
e2e/                      Playwright tests, one file per requirement group
```

Features built so far: `admin`, `vendors`, `agreements`, `warnings`, `import`, `settings`, `sow` (milestones, change requests,
consultants, rate cards), `invoices` (invoices and spend), `performance` (board links, Jira sync, monthly metrics, targets), `scorecards` (criteria, monthly AI proposals, quarterly scorecards, vendor PDF), `warnings` (warnings and risk flags), `dashboard` (the landing page's figures, shared with the report and briefings), `reports` (monthly management report and its PDF), `briefings` (vendor briefings and their PDF), `rfp` (demand, document, review, candidates, responses, comparison, scores, decision, with the Word, Excel and PDF files it makes), `chat` (Ask: the read-only look-ups, the search over document text, the one endpoint), `reading` (contract reading: the AI's proposal for an agreement's fields from a document, and taking values over). A feature imports from `platform`, `ai`
and `shared`, and from another feature only through that feature's `service.ts`.

## Request flow

1. Identity port gives the email; `platform/auth` finds or creates the user and attaches user and role.
2. The route validates input with Zod and checks the role with `requireRole`.
3. The service applies business rules and calls the repo inside a transaction.
4. `platform/audit` writes the audit entry in that transaction.
5. Errors leave as `{ error: { code, message, fields? } }` with a matching HTTP status.

## AI

- All model calls go through `server/ai`: a feature describes what it wants as a `Prompt` (in `server/ai/prompts/`, with a version), calls `ask`, and stores the answer with `recordSuggestion` as an AI suggestion row (model, prompt version, output, review status). Features never call the model port directly. The model is asked outside any database transaction; storing the answer and its audit entry is one transaction.
- When the model cannot be reached or answers something unusable, `ask` fails with `AiUnavailable` (HTTP 502, code `ai_unavailable`), whose message is written for the person on the page. Nothing is stored.
- Structured outputs (scores, extracted fields, RFP drafts) are requested as JSON and validated with Zod. An invalid response is retried once and then reported as a failure (AI-2).
- Numbers are computed in code and handed to the model. The model explains and proposes; it does not do arithmetic that the app then shows as fact.
- Free text from the model that sits next to figures (a report summary, a briefing) is checked with `server/ai/grounding.ts`: the prompt's `check` refuses an answer that quotes a number which was not in its input. The input is therefore written the way the app shows its figures, including the windows it uses ("90 days"). Names people typed are passed apart from the figures, so a number hidden in a title does not become quotable. Numbers written out in words are not caught; a person reads the text before it counts.
- A review of AI text carries the id of the suggestion that was on screen, and is refused when that is no longer the current one.
- A larger AI proposal follows the same rule in its own shape. An RFP draft is taken over as a whole and then edited as the RFP's own document; whether it still reads as drafted decides between accepted and edited. The comparison of RFP answers is asked once per criterion and stored as one suggestion; it gives no score, each evaluator's score records what the AI proposed at that moment, and its proposed scores must quote a passage found word for word in the candidate's answers.
- Text from outside the company that the model reads (tickets, vendors' answers) is passed as material, and the prompt says it is never an instruction. What the model makes of it is only ever a suggestion.
- A record that carries AI text keeps two things apart: the model's answer, untouched in its suggestion row, and the text a person saved on the record itself. Only the second is printed or exported.
- Ask (`server/features/chat`) answers a question in two model calls, both plain JSON prompts like every other; it does not use the model's own tool-calling, so it runs on any chat-completions endpoint. `ask-plan` (fast tier) picks up to four look-ups from the fixed list in `shared/ask.ts`; it is given no records, only the names of vendors, colleagues and RFPs so that it can recognise them. The app runs them (`lookups.ts`): each calls the service function its list page calls, with the same filter, and works out counts and totals in code. `ask-answer` (strong tier) writes the answer from those results; its `check` refuses a figure that was not in them and a source that was not looked up. For Ask the check is the stricter `ungroundedFigures`: a date counts as one thing and an amount counts with its currency, so the day of a date or a reference such as A12 never passes as a count, and pounds never pass as euros. There is no look-up that writes, and the feature has one endpoint, `POST /api/ask`. Each answer is stored as a suggestion row for traceability; nothing else is written, and there is no audit entry because no business record changes.
- A look-up result carries the address of the page that shows the same thing, so the screen can offer "Open the list". Row addresses and ids are never sent to the model; it refers to rows by short references (A1, B2) that the app maps back to links.
- The words in an uploaded document are read when it is attached (`server/platform/text.ts`: PDF by page with `unpdf`, .docx from its XML, .xlsx by sheet) and stored in `documents.extracted_text`. Reading is bounded (pages, characters, unpacked size) and never fails an upload. Passages are found in code by shared words (`server/features/chat/documents.ts`); with the volumes in the PRD that is a scan of a few hundred documents per question. Reading a document's text is derived from the file and changes nothing a person entered, so it writes no audit entry; attaching and removing the file do. Document passages are outside text: they are passed as material and the prompt says they are never instructions.
- Contract reading (`server/features/reading`, prompt `contract-fields`) follows the suggest-and-confirm rule in its own shape: the model returns a value and a passage per field, and `verifyReading` in `shared/reading.ts` keeps, field by field, only the values whose passage stands in the document on word boundaries and itself states the value (whole date expressions, an amount with its currency beside it, days of notice in a sentence about notice). Unlike the other prompts, a doubtful field does not fail the whole answer: it is left out and named, so one sloppy value does not cost the rest. The stored suggestion is the model's answer untouched; verification runs whenever the reading is shown or used, so nothing unverified can be saved. Taking values over calls `changeAgreement`, the edit form's own rules, inside the transaction that records the review. A document points to its current reading (`documents.reading_suggestion_id`); "the latest" is never worked out from timestamps. Reading again and reviewing both lock the document row first, so they take turns.
- Each prompt has a small evaluation set in `server/ai/evals/` with invented inputs and checks on the output. `npm run ai:eval` runs them against the Databricks model (inside the workspace), a model reached with `AI_EVAL_URL`, `AI_EVAL_KEY` and `AI_EVAL_MODEL`, or else the stand-in. `npm run check` runs them against the stand-in only, which proves the checks work and nothing about quality; cases that need real understanding are skipped there.
- Text sent to the model in production stays inside the Databricks workspace.

## Scheduled work

Scheduled work is a plain function in a feature's service, safe to run twice. It is started
three ways: by the app itself on a timer for as long as it runs (`server/platform/jobs/schedule.ts`,
wired in `server/main.ts`), by a button in the app, and by a command (`npm run job -- <name>`,
in `server/platform/jobs/run.ts`) for running it by hand or from a scheduler outside the app.

The Jira sync (`jira-sync`) runs every `JIRA_SYNC_EVERY_MINUTES` (60 by default, 0 for off):
each tick syncs the boards not tried within that interval. The monthly proposals (`monthly-proposals`) are looked at every
`AI_PROPOSALS_EVERY_MINUTES` (360 by default, 0 for off): a proposal is asked for only where last month's is still missing.
Documents attached before the app could read text are read once at start-up, in the background (`document-text`).
The timer lives inside the app because a Databricks App is one long-running process with
its own database sign-in; whether the app is kept running at night is a check for work (W9).

## Conventions

- Business rules live in `service.ts` or as pure functions in `shared/` with unit tests, never in routes or components. `shared/agreements.ts`, `shared/vendors.ts`, `shared/dates.ts`, `shared/money.ts` and `shared/sow.ts`, `shared/performance.ts`, `shared/risks.ts` (risk flags), `shared/rfp.ts` (RFP stages, the document's rules, matching an answer sheet, adding up scores, the next step) and `shared/overview.ts` (score trend, the shapes of dashboard, report and briefing) hold the rules for agreements, paperwork, warnings, days, amounts, budgets, milestones, change requests, rates, spend, and helpdesk metrics, targets and support levels.
- "Now" comes from `clock(config)`: the real time, or noon on the pinned `TODAY`. The stand-in Jira uses the same clock, so its invented helpdesk has always "got as far as" now.
- Figures worked out from many rows (monthly metrics) are counted in SQL, and the same SQL condition lists the rows behind each count (`inSet` in the performance repo), so a number and its drill-down cannot disagree.
- "Today" is the date in the team's time zone, supplied by the server (`/api/config`) so screen and server agree. `TODAY=YYYY-MM-DD` pins it for tests and demos, with stand-ins only.
- Request helpers shared by all routes are in `server/platform/http.ts`: `text`, `day`, `paging`, `like`, `failFields`, `toCsv`.
- Screens are built from the patterns in `client/src/platform`: `DataTable`, `SplitView` and `Panel`, `Tabs`, `Dialog`, `form` (`useForm` and the field components), `History`.
- List endpoints take `q`, filters, `sort`, `page`, `pageSize` and return `{ items, total }`. Filtering and sorting happen in SQL. The client keeps filters in the URL.
- Exports are produced on the server from the same query as the screen they belong to.
- A record with many parts (an RFP) is changed through one function that locks it, reads it whole, applies the rule and writes the history entry in the same transaction (`change` in `server/features/rfp/service.ts`); every change answers with the whole record, which replaces what the page shows.
- Word files are built with `docx` and Excel files with `exceljs`, on the server, from the same record the page shows. An uploaded workbook is opened only through `loadWorkbook` in the import feature, which refuses one that is too large or unpacks into far more than it seems; it counts the bytes each part really unpacks into, since the sizes a file declares can be made up.
- PDFs are drawn with the building blocks in `server/platform/pdf.ts` (title, headings, paragraphs, label and value rows, tables, a footer with page numbers). `makePdf` reports the number of pages, so a document with a page limit can be drawn again with shorter tables. The built-in fonts cover Western European characters; anything else is replaced by a question mark.
- Timestamps are stored in UTC and shown in the team's time zone (`APP_TIME_ZONE`, default Europe/Amsterdam). "A day" in a filter means a day in that zone.
- Date-only fields use the Postgres `date` type.
- Search text is matched literally (`like()` in a repo escapes `%` and `_`), and free text from the address is validated with the shared `text` schema.
- Every call to an outside service has a time limit (`limit()`), and failures shown to people go through `explain()` so they read as plain language and never carry internal detail.
- A record opened from a list is fetched by its id, so a shared link works whatever the list's page or filters. Opening a record adds a Back step; filter changes do not.

## Testing

- Each rule in `domain-model.md` has a unit test.
- Each endpoint has API tests for the happy path, validation failure and each role.
- Each acceptance criterion has a Playwright test named with its requirement ID, for example `A-6 decided subscription leaves the list`.
- Tests use the built-in Postgres, the fake Jira and the scripted AI. The database is not mocked. CI also runs the database contract against a Postgres 16 server.
- Every browser test creates the people it needs, so any test can run alone.
- All server tests also run on a Postgres 16 server in CI (`TEST_DATABASE_URL`), each on a database of its own.
- Browser tests run against the bundled server (`dist/server/main.js`, as deployed) on a fresh in-memory database with the sample people, signed in through the local stand-in (`dev_user` cookie).
