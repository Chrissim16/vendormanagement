# Moving the app into Databricks: instructions for the AI in Cursor

You are an AI agent in Cursor on the owner's work laptop, with a Databricks connection
(MCP) to the company workspace. You are deploying this repository as a Databricks App and
connecting it to the company's services, with the owner watching. The owner is not a
developer: talk to them in plain language, one step at a time, and say what you are about
to do before you do it.

This is milestone M9 of `docs/plan/implementation-plan.md`. The owner's guide for the same
steps is `docs/runbook.md`. The app was built outside the company and has never run in
Databricks: the code for the company services is written from documentation and marked
UNPROVEN. Expect a few things not to work at first; your job is to set everything up, find
out what works, fix what is a setting, and report the rest precisely.

## Rules (decided by the owner; do not depart from them)

1. **Change only settings.** You may change `app.yaml` (the values and `env` entries) and
   the app's configuration in Databricks (resources, permissions, compute size). You may not
   change program code, `package.json`, `package-lock.json`, migrations or anything else in
   the repository. When something needs more than a setting, stop that step, write it into
   the report (below), and go on with the steps that do not depend on it.
2. **Never push.** This copy is the owner's work copy. Never commit to or push to GitHub,
   and never copy anything from the company (emails, names, URLs, data, logs with data in
   them) into the repository. The owner's email and the Jira address go into `app.yaml`
   here only.
3. **The Jira access key is typed by the owner.** Create the secret scope and the key named
   `jira-token` without a value, or tell the owner exactly where to paste it (the
   workspace's secret settings, or `databricks secrets put-secret vendorapp jira-token` in
   their own terminal, which asks for the value). Never ask for it, never read it back,
   never print any secret's value, and never log the values of request headers.
4. **Create resources only after saying so.** Before creating anything (database, volume,
   secret scope, app), tell the owner what you will create, its name and where, and wait for
   their OK. Where the owner's account is not allowed to create it, stop and tell the owner
   in one sentence what to ask IT for.
5. **Touch nothing else.** Do not change, restart or delete other apps, databases, volumes,
   endpoints or permissions in the workspace. Read-only look-ups are fine.
6. **No real data in test steps.** For trying things out, use invented names and the
   invented example template the app offers. Real vendors and agreements are entered by the
   owner, in the app.

## Before step 1: find out what you can do

- Find out who the owner is in Databricks (their user name / email) and which cloud the
  workspace runs on (AWS, Azure, GCP). You will need the email in step 2.
- List what the Databricks connection lets you do. If it cannot create or deploy apps, or
  manage volumes or secrets, say which steps the owner will do in the workspace's screens
  instead; the steps below say what to click.
- Find out which kind of Lakebase the workspace offers: **Lakebase Autoscaling** (database
  projects) or only **Lakebase Provisioned** (database instances). The app prefers
  Autoscaling. This answers open question W1.
- Find out whether the workspace restricts outbound network for apps (network policies or
  serverless egress control). The app must reach the company's Jira Cloud site
  (`*.atlassian.net`). This answers W2; if it is restricted, the owner asks IT to allow the
  Jira site.

## Step 1: get the code

Download the repository from GitHub: the branch it opens by default,
`claude/jolly-curie-d4v8z0` (it holds everything up to and including M12), unless the owner
names another. Use a fresh folder. Leave out `node_modules`, `dist`, `.data` and `.git` when you upload it in
step 5; Databricks installs and builds the app itself.

## Step 2: the two settings only the company knows

In `app.yaml`:

- `BOOTSTRAP_ADMIN_EMAIL`: the owner's work email, exactly as they sign in to Databricks.
  The app refuses to start with the placeholder. This person becomes the first admin.
- `JIRA_BASE_URL`: the company's Jira Cloud address, for example `https://name.atlassian.net`.
  The app refuses to start with the placeholder. Ask the owner for it.

Change nothing else in `app.yaml` yet.

## Step 3: what the app needs

Create these (rule 4), or find the ones IT made. Names in brackets are suggestions; keep
them simple and tell the owner what you chose.

| What | Notes |
|---|---|
| A Lakebase database (`vendorapp`) | Autoscaling project if available. The app creates its own tables when it starts, as its service principal; do not create tables yourself, because tables created by another identity are not the app's. |
| A Unity Catalog volume (`vendorapp_files`) | In a catalog and schema the owner chooses (ask). Holds uploaded documents, review copies and the Word template. |
| Two model serving endpoints | Not created: chosen. List the workspace's serving endpoints and, with the owner, pick a strong chat model for writing and a fast one for quick look-ups. Both must accept the chat-completions request shape (`messages`). They may be the same endpoint. This answers W4. |
| A secret scope (`vendorapp`) with two keys | `jira-email`: the Jira service account's email (you may set this one; ask the owner for it). `jira-token`: the API token, typed by the owner (rule 3). |

## Step 4: create the app and attach the resources

Create a custom app named `vendorapp` (Compute, Apps, Create app, Custom). Attach the
resources with **exactly these keys**, because `app.yaml` refers to them by key:

| Key | Resource | Permission |
|---|---|---|
| `postgres` | The Lakebase database | Can connect and create |
| `volume` | The volume | Can read and write |
| `ai-strong` | The strong serving endpoint | Can query |
| `ai-fast` | The fast serving endpoint | Can query |
| `jira-email` | Secret `vendorapp` / `jira-email` | Can read |
| `jira-token` | Secret `vendorapp` / `jira-token` | Can read |

**If only Lakebase Provisioned is available**, attach the database instance instead (its
resource kind is a database instance with a database name; the key may stay `postgres` or
be `database`) and change `app.yaml`: remove the `LAKEBASE_ENDPOINT` entry and add
`LAKEBASE_INSTANCE` with the instance's name as its value. The app then connects with the
`PGHOST`, `PGDATABASE`, `PGPORT` and `PGUSER` values Databricks gives it; if the app's log
says one of those is missing, add it to `app.yaml` with the value shown on the instance's
page (connection details), and note it in the report.

## Step 5: upload and deploy

Upload the folder to a workspace folder (for example `/Workspace/Users/<owner>/vendorapp`)
and deploy the app from it (`databricks sync` then `databricks apps deploy vendorapp
--source-code-path <folder>`, or the Deploy button). Databricks runs `npm install` and
`npm run build`, then `npm run start` (the `command` in `app.yaml`). The first build takes
a few minutes.

Watch the app's log (`databricks apps logs vendorapp`, or the app's Logs tab). When it
works the last line says `vendorapp is running at ...`. If the build or start fails, read
the log: a missing setting or a misspelled resource key is yours to fix (rule 1); anything
in the program is for the report.

Before every later deploy, note which version you deploy (the branch and the date, or the
GitHub commit), so it can be deployed again if a new one goes wrong (see "Going back").

## Step 6: who may open it

Give **Can use** to the members of the VS Finance team only (the owner names them). Keep the
owner as **Can manage**. Add people one by one (`update-permissions`); do not replace the
whole list (`set-permissions` would drop the owner unless they are in it).

## Step 7: the owner opens it

Ask the owner to open the app from the Apps page. They should see the dashboard, with their
name and "Admin" in the bottom-left corner. If they are a member instead, the email in step 2
differs from their sign-in name: correct it and deploy again.

## Step 8: the system check

The owner opens Admin, System check. Each row (Sign-in, Database, File storage, Jira, AI
model) should say "Working" and "Real service"; the page has a button to run each port's
contract tests against the real service. For a row that does not:

| Row | Likely cause | Yours to fix? |
|---|---|---|
| Sign-in | The platform does not send `X-Forwarded-Email` (only documented as "forwarded user headers"). | No: report which `X-Forwarded-*` header names arrive (names only, never values). |
| Database | Missing permission, or Provisioned without the changes in step 4. | Yes if it is a permission or a setting. |
| File storage | Volume not attached as `volume`, or no write permission. | Yes. |
| Jira, "could not reach" | Outbound network blocked (W2). | No: the owner asks IT to allow the Jira site. |
| Jira, "refused the sign-in" | Wrong email or token, or a newer "scoped" token that needs another address (W8). | Ask the owner to check the token; report if it persists. |
| AI model | Wrong endpoint, no Can query, or an endpoint that does not take chat messages. | Yes if it is the choice of endpoint or the permission. |

## Step 9: once it runs

Do these with the owner; they decide what is good enough.

1. **Jira** (runbook "After the first deployment: Jira"): the owner links one vendor to its
   board on Performance, presses Test link and reads what it says, saves, and compares one
   month's figures with Jira's own reports. Report anything Test link calls missing (W8).
2. **AI** (runbook "After the first deployment: AI proposals"): one monthly proposal on
   Performance. Then the evaluation sets, if Node.js 20 or newer is on this laptop: in the
   repository folder run `npm install`, then `npm run ai:eval` with
   `AI_EVAL_URL=https://<workspace host>/serving-endpoints/<endpoint>/invocations`,
   `AI_EVAL_MODEL=<endpoint>` and `AI_EVAL_KEY` set by the owner in their own terminal to a
   token from `databricks auth token` (rule 3 applies to it). Run it once per endpoint.
   Put the PASS/FAIL list in the report.
3. **The company's Word template** (W10, W12): the owner types [Title], [Date] and
   [Version] on its cover page, uploads it on Settings, reads what the app found, downloads
   one RFP review copy and opens it in Word. If they can, a colleague comments in Word and
   sends it back, and the owner uploads it to its round (W11).
4. **Real data**: the owner first saves the real exchange rates in Settings, "Currencies and
   exchange rates" (the starting rates are rough and marked as such), then enters vendors
   and agreements with Admin, Import.
5. A 25 MB upload (any large PDF on an agreement) to see that the platform lets it through.

## Going back, and backups

- **A new version goes wrong**: first report it; a fix is usually quicker than going back.
  Deploying the earlier version again (from its folder or commit; the app's Deployments
  list shows what was deployed when) is safe only when no database change came with the
  new version: compare the files in `db/migrations/` of the two versions. If the new one
  added a migration, the database has already been changed when it started, and the earlier
  version may not run on it (some migrations change or remove columns). Then the way back
  is to restore the database to just before that deploy (below), which loses what was
  entered since: that is the owner's decision, never yours.
- **Backups**: Lakebase keeps its own history. Autoscaling: point-in-time restore (2 to 30
  days, 7 by default) into a new branch, which leaves the current data alone; Provisioned:
  restore within its window (up to 35 days). Tell the owner how long the window is set to
  in this workspace, and note it in the report. Uploaded files live in the volume; ask IT
  whether volumes are backed up.

## The report to bring back

At the end, and whenever you stop a step, write the report into a new file outside the
repository folder (for example on the desktop), in plain language, with:

1. Date, workspace cloud, Lakebase kind, the app's URL host (no paths with personal data).
2. Each step: done, done with a change, or stopped, and why.
3. Every change to `app.yaml`, shown with the email and the Jira address replaced by
   `<owner email>` and `<jira address>`.
4. The system check: each row's state and detail text.
5. For every failure: the exact message on screen and the relevant log lines, with any
   email, name, URL with a company name, or token removed.
6. Answers to the open checks W1 to W12 in `docs/open-questions.md` that this session
   could answer.
7. The evaluation results, if run.

The owner brings this report back to the project, where whatever needs code is fixed,
tested and pushed; then you deploy the new version (step 5) and run step 8 again.

## What is known not to be proven

From the documentation check of 22 Nov 2026 (the official pages could only be read in
part from outside the company):

- The signed-in user's email header (`X-Forwarded-Email`): only "forwarded user headers"
  are documented.
- How the Provisioned database's password is fetched (`server/platform/ports/databricks.ts`).
- The Files API path used to write to the volume (`server/platform/ports/storage.ts`).
- The serving endpoints' invocation path and token scope (`server/platform/ports/ai.ts`,
  `databricks.ts`).
- The limits on upload size and request time.

Each of these shows up in the system check or in the first use; report what you see.
