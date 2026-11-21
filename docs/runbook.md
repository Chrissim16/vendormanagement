# Runbook: moving the app into Databricks

Written for the owner, who is not a developer. Nothing below has been tried on a real
workspace yet; the first deployment is where it gets proven. Expect to fix a few things,
and use the system check page to find out which.

## Before you start

You need, at work:

1. A Databricks workspace where you may create an app.
2. A Lakebase database (Autoscaling if available).
3. A Unity Catalog volume for uploaded documents.
4. The names of two model serving endpoints: one strong model, one fast one.
5. The Jira service account's email and API token, stored as two Databricks secrets.
6. Node.js is not needed on your laptop; Databricks builds the app itself.

## Steps

1. **Get the code.** Download the repository from GitHub as a ZIP and unpack it, or clone it.
2. **Set the first admin.** Open `app.yaml` and replace `change-me@example.test` with your work email, and `change-me.atlassian.net` with your Jira address. The app refuses to start while the placeholder email is still there, so this step cannot be skipped by accident.
3. **Create the app.** In Databricks: Compute, Apps, Create app, Custom. Name it `vendorapp`.
4. **Attach resources.** In the app's settings add these resources with exactly these keys:

   | Key | Resource | Permission |
   |---|---|---|
   | `postgres` | The Lakebase database | Can connect and create |
   | `volume` | The Unity Catalog volume | Read and write |
   | `ai-strong` | Serving endpoint, strong model | Can query |
   | `ai-fast` | Serving endpoint, fast model | Can query |
   | `jira-email` | Secret with the Jira account email | Can read |
   | `jira-token` | Secret with the Jira API token | Can read |

5. **Upload and deploy.** Upload the unpacked folder to the workspace and deploy the app from it. The first build takes a few minutes.
6. **Limit who can open it.** In the app's permissions, give "Can use" to the VS Finance team members only.
7. **Open the app.** You should see the dashboard with your name and "Admin" in the bottom left corner.
8. **Run the system check.** Admin, System check. Every row should say "Working" and "Real service". For any row that does not, the page says what is wrong and what to do.

## If something goes wrong

| What you see | Likely cause |
|---|---|
| The app does not start; the log says a setting is missing | A resource key in step 4 is misspelled or not attached. |
| The app does not start; the log mentions `vite` or `esbuild` | The build tools were not installed. Tell the agent; the fix is in `package.json`. |
| The log says `BOOTSTRAP_ADMIN_EMAIL` must be a real work email | Step 2 was skipped. |
| You are a member, not an admin | The email in step 2 does not match your sign-in address. Correct it and deploy again; you become admin at your next visit as long as nobody else is one. |
| "We could not sign you in" | The app was opened by a direct server link. Use the app's address from the Apps page. |
| Database row not working | The app's service principal lacks permission on the Lakebase database, or the workspace has Lakebase Provisioned: remove `LAKEBASE_ENDPOINT` from `app.yaml` and add `LAKEBASE_INSTANCE` with the instance name. |
| Jira row not working, "could not reach" | Databricks Apps may not be allowed to connect out to Atlassian. Ask IT. |
| AI row not working | Wrong endpoint, or the app lacks "Can query" on it. |

The app updates its own database tables every time it starts. There is nothing to run by hand.

## Updating later

Download the new version from GitHub, upload it over the old folder, and deploy again.
Data stays in Lakebase and the volume.

## Still to write (at milestone M9)

Rolling back to a previous version, and backups.

## After the first deployment: Jira

1. Open System check; the Jira row should say how many boards the account can see.
2. On Performance, press Link a board, choose a vendor and its board, and press Test link. It lists the board's statuses and labels and says if this Jira lacks the response-time, resolution-time or satisfaction measurements (open question W8).
3. Save. The tickets are fetched at once; after that the app fetches changes every hour by itself (`JIRA_SYNC_EVERY_MINUTES`). If figures stay empty although the board has tickets, note what Test link said and pass it on: a field in this Jira is probably named differently.
