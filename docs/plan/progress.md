# Progress

Newest entry first. Written for the owner, in plain language.

## Status

| Milestone | State |
|---|---|
| M0 Foundation | Done |
| M1 Vendors and agreements | Not started |
| M2 SOW delivery and money | Not started |
| M3 Performance from Jira | Not started |
| M4 Scorecards and AI scoring | Not started |
| M5 Briefings, risk flags, dashboard, report | Not started |
| M6 RFP | Not started |
| M7 Ask a question | Not started |
| M8 Contract reading | Not started |
| M9 Move to Databricks | Not started; done at work |

**Next:** M1 Vendors and agreements.

## Log

### 2026-11-22 Change request: handing over records when someone leaves
Every vendor and agreement has an owner, but nothing stopped you deactivating a person and leaving their records ownerless. Now an admin cannot deactivate someone who owns records until a new owner is chosen, for all at once or one by one. Any member can change an owner day to day. New agreements start with their vendor's owner. An admin sees how many records each person owns. It sits in M1 and reworks the deactivate action and user page already built in M0. Added as V-5.

### 2026-11-21 Change request: bigger spreadsheet import
Excel import was already planned for vendors and agreements. It now also loads contacts, and in the money milestone, rate cards and past invoices. Any team member can run it, not only the admin. Existing records are skipped, never overwritten. Rejected rows can be downloaded with the reasons, fixed and uploaded again. The template gets example rows and a help sheet, because your data is not in one clean spreadsheet. Nothing already built changes. M1 grows a little (contacts, rejected-rows file, help sheet) and M2 gains one requirement.

### 2026-11-21 M0 Foundation done
The app now exists and runs. What you can do in it:

- Open it and be recognised straight away, with your name and role shown in the bottom left corner. Anyone opening it for the first time is added as a member; the first admin is whoever is named in the settings.
- As an admin, see everyone who has signed in, make someone an admin or a member, and switch someone's access off and on. The app will not let the last admin be removed.
- See the history of every change on a person's panel, and browse the full audit log, filtered by person, type of record and date.
- Run the system check, which tests the five connections (sign-in, database, file storage, Jira, AI model) and says in plain words what is wrong and what to do when one fails.
- Switch between light and dark, and move around all the sections. Vendors, Agreements, Money, Performance, RFPs and Ask each explain what will live there.

How it was checked: an independent tester used the running app against every requirement, and an independent reviewer read all the code. Between them they raised two serious problems and about twenty smaller ones; all were fixed and re-tested. The two serious ones were that a wrong "first admin" setting at deployment would have locked you out for good, and that a dropped database connection could have stopped the app.

Decided on your behalf (see `docs/open-questions.md`):

- Times are shown in Amsterdam time (Q5).
- The app does not use Databricks' AppKit framework, only its small database helper, so that it can run and be tested outside Databricks. Recorded in decision 0001.
- While building, the database is built into the app, so nothing has to be installed to run it.
- Forms, file upload and PDF export moved from this milestone to M1, where the first screens need them.

What has not been proven: everything that only exists at work. The real sign-in, Lakebase, the document volume, Jira and the AI models are written from documentation and have never run. The system check page and `docs/runbook.md` are there to make that first deployment quick.

### 2026-11-21 PRD written, plan reworked
After three rounds of questions the brief became a full product requirements document.
The product is now a vendor and contract management tool for the VS Finance team, built
around MSAs and SOWs, with helpdesk scoring from Jira, AI-proposed scorecards, briefings,
a monthly management report and a guided RFP process. The requirements, data model,
architecture and plan were rewritten to match. The plan now has ten milestones.

### 2026-11-21 Project set up
First version of the brief, requirements, plan and agent workflow. No application code yet.

## Follow-ups
- The database does not itself forbid an unknown role or an edit to the audit log; only the app's code does. Worth adding as database rules in M1.
- A person's name is taken at first sign-in and not refreshed if it later changes in the company directory.
- If two browser tabs are open, one can show a person's role up to 15 seconds out of date.
- The date boxes in the audit log follow the browser's own date format, which may be month-first on some machines.
- Deploy the empty app once at work as a rehearsal (open question Q3).
