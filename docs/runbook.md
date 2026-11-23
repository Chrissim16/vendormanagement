# Runbook: moving the app into Databricks

Written for the owner, who is not a developer. Nothing below has been tried on a real
workspace yet; the first deployment is where it gets proven. Expect to fix a few things,
and use the system check page to find out which.

**How it is done (decided 22 Nov 2026):** the AI in Cursor on your work laptop carries out
these steps through its Databricks connection, while you watch and check. Its instructions
are in `docs/deploy-with-cursor.md`: give it that file and this one, and ask it to start.
This guide says what happens at each step and what you should see, so you can follow and
check it, and do a step by hand where the AI cannot.

## The rules you gave the AI

- It may change only settings: the file `app.yaml` and the app's settings in Databricks. It
  never changes the program. Anything more is written down and brought back here.
- It tells you before it creates anything, and waits for your OK. Where your account is not
  allowed to create something, it says what to ask IT for.
- You type the Jira access key into Databricks yourself; it never sees it.
- It never sends anything back to GitHub, and puts no company data into the project.
- At the end, or when it has to stop, it writes a report. Bring that report back here.

## Before you start

You need, at work:

1. Cursor on your work laptop with its Databricks connection to the company workspace.
2. Permission in that workspace to create an app. Where you may not create the database,
   the storage folder or the secrets yourself, IT creates them; the AI tells you what to ask.
3. The company's Jira address and a Jira service account: its email and an access key.
4. The project: the branch GitHub opens by default, `claude/jolly-curie-d4v8z0`, which holds
   everything up to and including M12.
5. For the template step: the company's Word template, with [Title], [Date] and [Version]
   typed on its cover page where they should appear.

Node.js is not needed on your laptop for the move itself; Databricks builds the app. It is
needed only for the AI test run in "After the first deployment: AI", which is optional.

## Steps

1. **Find out what is possible.** The AI checks what its connection may do, which cloud the
   workspace runs on, which kind of database (Lakebase) the workspace offers, and whether
   apps may reach Jira over the network. It tells you what it found.
2. **Get the code.** The AI downloads the project into a fresh folder on your laptop.
3. **Two settings only the company knows.** In `app.yaml` the AI puts your work email (you
   become the first admin) and the company's Jira address. The app refuses to start while
   either placeholder is still there, so this cannot be skipped by accident. These stay on
   your laptop; they never go to GitHub.
4. **What the app needs.** The AI proposes, and after your OK creates: a database, a storage
   folder (a "volume") for documents, and a place for the two Jira secrets. With you it
   picks two of the company's AI models: a stronger one for writing and a faster one for
   quick look-ups. You paste the Jira access key into the secret yourself; the AI shows you
   where.
5. **Create the app.** In Databricks: Compute, Apps, Create app, Custom, named `vendorapp`.
   The AI connects it to the six things from step 4 under these exact names: `postgres`,
   `volume`, `ai-strong`, `ai-fast`, `jira-email`, `jira-token`.
6. **Upload and start it.** The AI uploads the folder and deploys it. Databricks installs
   and builds it; the first time takes a few minutes. The log ends with "vendorapp is
   running" when it worked.
7. **Decide who can open it.** "Can use" for the VS Finance team members you name, and
   nobody else. You keep "Can manage".
8. **Open it.** From the Apps page. You should see the dashboard with your name and "Admin"
   in the bottom left corner.
9. **Run the system check.** Admin, System check. Every row should say "Working" and "Real
   service". For any row that does not, the page says what is wrong, and the AI knows which
   of those it may fix and which go in the report.

The app sets up its own database tables every time it starts. There is nothing to run by hand.

## If something goes wrong

| What you see | Likely cause |
|---|---|
| The app does not start; the log says a setting is missing | A name in step 5 is misspelled or not attached. The AI fixes it. |
| The log says `BOOTSTRAP_ADMIN_EMAIL` or `JIRA_BASE_URL` must be set | Step 3 was skipped. |
| You are a member, not an admin | The email in step 3 differs from your sign-in name. The AI corrects it and deploys again; you become admin at your next visit as long as nobody else is one. |
| "We could not sign you in" | The app was opened by a direct server link, or Databricks does not pass the signed-in person the way the app expects. Open it from the Apps page; if it persists, it goes in the report. |
| Database row not working | A missing permission, or the workspace only has the older kind of Lakebase ("Provisioned"). The AI knows the settings for both. |
| Jira row: "could not reach" | Databricks apps may not connect out to Atlassian. Ask IT to allow the company's Jira site. |
| Jira row: "refused the sign-in" | Check the access key. If it is right, the key may be a newer kind that needs another address: it goes in the report. |
| AI row not working | A wrong model choice, or the app may not use it. The AI fixes it. |
| Anything else | The AI writes it in the report. Bring the report back here. |

## After the first deployment: Jira

1. The Jira row on the system check says how many boards the account can see.
2. On Performance, press Link a board, choose a vendor and its board, and press Test link.
   It lists the board's statuses and labels and says if this Jira lacks the response-time,
   resolution-time or satisfaction measurements (open question W8).
3. Save. The tickets are fetched at once; after that the app fetches changes every hour by
   itself. If figures stay empty although the board has tickets, note what Test link said:
   a field in this Jira is probably named differently.
4. Compare one month's figures with Jira's own reports. If every ticket of a board shows as
   solved by the first line although some were escalated, or satisfaction stays empty while
   the other figures appear, it goes in the report.

## After the first deployment: AI

1. The AI row on the system check says both models answered.
2. Open a helpdesk vendor on Performance, choose last month and press "Ask the AI for a
   proposal". A proposal with two scores, their reasons and ticket themes should appear
   within about a minute.
3. Optional, if Node.js is on your laptop: the AI in Cursor runs the AI test sets against
   the chosen models. They show whether the model's scores, summaries, answers and RFP
   rewrites are sensible on invented examples and keep to the figures they are given. So
   far only the simple stand-in has answered them. For the access key this needs, you type
   it in your own terminal, as with the Jira key.
4. From then on the app writes last month's proposals by itself; it looks every six hours.

## After the first deployment: the Word template and a review round

1. Settings, Word template: upload the company's template and read what the app found.
   Each of [Title], [Date] and [Version] should say where it was found.
2. Download one RFP review copy and open it in Word: the cover page, logo, header and
   footer should be the company's, with the title, the date and the version filled in.
3. If you can, have a colleague comment in it and track changes in Word, send it back, and
   upload it to its round on the Review tab. If the app says it is not a review copy,
   Word or SharePoint dropped the file's hidden mark (open question W11): it goes in the report.

## After the first deployment: your data

First, in Settings, "Currencies and exchange rates": save the real rate for each currency the
team uses (the dollar and the three kronor start with rough rates, and every euro total says
so until an admin saves a real one). Then enter the real vendors, contacts, agreements, day
rates and past invoices with Import in the menu on the left (anyone in the team can). The
import template is on that page; rows with a problem can be downloaded, fixed and uploaded
again.

## Going back to an earlier version

Report a problem first: a fix is usually quicker than going back. Deploying the earlier
version again is safe when the new version brought no change to the database's tables. When
it did, the earlier version may not run on the changed tables, and going back means also
restoring the database to just before the new version started, which loses everything
entered since. That is your decision; the AI never takes it.

Before every deploy, the AI notes which version it deploys, so you always know which one to
go back to.

## Backups

The database keeps its own history: the newer kind of Lakebase can restore any moment of
the last 7 days (up to 30, as set in the workspace), into a copy, without touching the data
in use; the older kind up to 35 days. The AI tells you what your workspace is set to.
Uploaded documents live in the storage folder; ask IT whether those folders are backed up.

## Updating later

Download the new version from GitHub, and ask the AI in Cursor to deploy it as in step 6 and
to run step 9 again. Your data stays in the database and the storage folder.
