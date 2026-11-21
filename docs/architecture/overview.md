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
| Identity | `DEV_USER_EMAIL` | `X-Forwarded-Email` from the Databricks Apps proxy |
| Database | Built-in Postgres in `.data/pg` (in memory for tests), or `DATABASE_URL` | Lakebase app resource |
| File storage | Folder on disk | Unity Catalog volume |
| Jira | Fake Jira serving invented tickets in the real API's shape | Jira Cloud REST API with a service account |
| AI model | Scripted fake for tests; optionally a real model through an API key for judging output quality | Databricks model serving endpoint |

Rules:
- Feature code depends on the port interface only, never on an implementation.
- Each port has a contract test suite that both implementations must pass. The deployed implementations' contract tests can be run from the system check page (F-4).
- No Databricks, `pg` or PGlite import outside `server/platform`. ESLint enforces this.
- Deployed implementations are written from documentation and marked UNPROVEN in the code until the first deployment.
- Which set is used is decided by `PLATFORM` (`local` or `databricks`). The app refuses to start with stand-ins inside Databricks.

## Shape of the code

```
server/
  features/<feature>/     routes.ts, service.ts, repo.ts, schema.ts, *.test.ts
  platform/               auth, roles, audit, db, errors, config, ports/, jobs/
  ai/                     prompts/ (versioned), suggestions.ts, evals/
client/src/
  features/<feature>/     pages, components, hooks
  platform/               layout, session, shared components (ui, DataTable, SplitView, History)
  lib/                    api client, URL state, formatting, motion presets, theme
shared/                   types, Zod schemas, pure business rules
db/schema, db/migrations, db/seed
e2e/                      Playwright tests, one file per requirement group
```

Features: `vendors`, `agreements`, `sow`, `invoices`, `performance`, `scorecards`,
`briefings`, `rfp`, `chat`, `dashboard`, `admin`. A feature imports from `platform`, `ai`
and `shared`, and from another feature only through that feature's `service.ts`.

## Request flow

1. Identity port gives the email; `platform/auth` finds or creates the user and attaches user and role.
2. The route validates input with Zod and checks the role with `requireRole`.
3. The service applies business rules and calls the repo inside a transaction.
4. `platform/audit` writes the audit entry in that transaction.
5. Errors leave as `{ error: { code, message, fields? } }` with a matching HTTP status.

## AI

- All model calls go through `server/ai`, which records an AI suggestion row (model, prompt version, output, review status). Features never call the model port directly.
- Structured outputs (scores, extracted fields, RFP drafts) are requested as JSON and validated with Zod. An invalid response is retried once and then reported as a failure (AI-2).
- Numbers are computed in code and handed to the model. The model explains and proposes; it does not do arithmetic that the app then shows as fact.
- Chat answers questions by calling a fixed set of read-only query tools that reuse the list endpoints' queries, plus a search over extracted document text. It has no write tools.
- Each prompt has a small evaluation set in `server/ai/evals/` with invented inputs and checks on the output. These run on demand against a real model, not in `npm run check`.
- Text sent to the model in production stays inside the Databricks workspace.

## Scheduled work

Jira sync and monthly metric and proposal runs are plain functions in
`server/platform/jobs/`. Each can be started three ways: a button in the app, a command
(`npm run job -- <name>`), and a scheduled Databricks job that runs that command. Jobs are
safe to run twice.

## Conventions

- Business rules live in `service.ts` or as pure functions in `shared/` with unit tests, never in routes or components.
- List endpoints take `q`, filters, `sort`, `page`, `pageSize` and return `{ items, total }`. Filtering and sorting happen in SQL. The client keeps filters in the URL.
- Exports are produced on the server from the same query as the screen they belong to.
- Timestamps are stored in UTC. Date-only fields use the Postgres `date` type.

## Testing

- Each rule in `domain-model.md` has a unit test.
- Each endpoint has API tests for the happy path, validation failure and each role.
- Each acceptance criterion has a Playwright test named with its requirement ID, for example `A-6 decided subscription leaves the list`.
- Tests use the built-in Postgres, the fake Jira and the scripted AI. The database is not mocked. CI also runs the database contract against a Postgres 16 server.
- Browser tests run against the built app on a fresh in-memory database with the sample people, signed in through the local stand-in (`dev_user` cookie).
