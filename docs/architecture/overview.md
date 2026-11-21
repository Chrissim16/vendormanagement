# Architecture overview

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, strict mode |
| Platform | Databricks Apps (Node.js runtime) |
| App framework | Databricks AppKit: Express server plus React client |
| Database | Lakebase Autoscaling (managed Postgres); plain Postgres locally and in tests |
| Data access | Drizzle ORM with SQL migration files |
| Validation | Zod schemas shared by server and client |
| UI | React, AppKit UI components, TanStack Query for server data |
| Tests | Vitest for unit and API tests, Playwright for end-to-end tests |
| Checks | ESLint, Prettier, `tsc --noEmit`, all behind `npm run check` |

Reasons are in `decisions/`. AppKit is at version 0 and its APIs move; the exact project
layout below follows whatever `databricks apps init` generates at M0 and this file is
updated to match.

## Shape of the code

```
server/
  features/<feature>/     routes.ts, service.ts, repo.ts, schema.ts (Zod), *.test.ts
  platform/               auth, roles, audit, db, errors, config
client/
  features/<feature>/     pages, components, hooks
  platform/               layout, api client, shared components
shared/                   types and Zod schemas used by both sides
db/
  schema/                 Drizzle table definitions
  migrations/             generated SQL, never edited after commit
  seed/                   sample data for local use and tests
e2e/                      Playwright tests, one file per requirement group
```

Features are `vendors`, `contracts`, `spend`, `performance`, `dashboard`, `admin`. A feature
may import from `platform` and `shared`, and from another feature only through that
feature's `service.ts`.

## Request flow

1. The Databricks Apps proxy authenticates the person with Entra ID and adds `X-Forwarded-Email`.
2. `platform/auth` reads the header (or `DEV_USER_EMAIL` when `NODE_ENV` is not production), finds or creates the user, and attaches user and role to the request.
3. The route validates input with a Zod schema, and checks the role with `requireRole`.
4. The service applies business rules and calls the repo inside a transaction.
5. `platform/audit` writes the audit entry in that same transaction.
6. Errors leave the server as `{ error: { code, message, fields? } }` with a matching HTTP status.

The app connects to Lakebase as its own service principal. Who may do what is decided by
the role in the app's `users` table, not by per-person database roles.

## Conventions

- Business rules live in `service.ts`, never in routes or React components. Derived values such as notice deadline and renewal state are pure functions in `shared/` with unit tests.
- List endpoints take `q`, filters, `sort`, `page`, `pageSize` and return `{ items, total }`. Filtering and sorting happen in SQL.
- The client keeps list filters in the URL so views can be reloaded and shared.
- CSV exports are produced on the server from the same query as the list.
- All timestamps are stored in UTC. Date-only fields use the Postgres `date` type.

## Testing

- Each business rule in `domain-model.md` has a unit test.
- Each endpoint has API tests for the happy path, validation failure and each role.
- Each acceptance criterion in `requirements.md` has a Playwright test named with the requirement ID, for example `V-2 rejects duplicate vendor name`.
- Tests run against a real Postgres database that is migrated and seeded per run. The database is not mocked.

## Environments

| | Local and CI | Deployed |
|---|---|---|
| Database | Postgres from `DATABASE_URL` | Lakebase, attached as an app resource |
| Identity | `DEV_USER_EMAIL` | `X-Forwarded-Email` from the proxy |
| Config | `.env` (see `.env.example`) | `app.yaml` and app resources |
