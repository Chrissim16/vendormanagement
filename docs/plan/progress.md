# Progress

Newest entry first. Written for the owner, in plain language.

## Status

| Milestone | State |
|---|---|
| M0 Foundation | Done |
| M1 Vendors and agreements | Done |
| M2 SOW delivery and money | Done |
| M3 Performance from Jira | Done here; the real Jira connection is unproven until tried at work |
| M4 Scorecards and AI scoring | Not started |
| M5 Briefings, risk flags, dashboard, report | Not started |
| M6 RFP | Not started |
| M7 Ask a question | Not started |
| M8 Contract reading | Not started |
| M9 Move to Databricks | Not started; done at work |

**Next:** M4 Scorecards and AI scoring.

## Log

### 2026-11-21 Jira connection checked against Atlassian's documentation
The check left open at the end of M3 is done: this build environment can open Atlassian's developer documentation, and the Jira connection was compared with it point by point.

**Confirmed as written:** the call that searches for tickets and how its pages follow each other; the call that lists Jira's fields (where the app finds the response-time and satisfaction measurements by name); the three calls about boards; the shape of a response-time (SLA) result, with finished rounds and a running one; how Jira writes dates and times; and the way of signing in with an email address and an API token.

**Changed, because the documentation showed a better or safer way:**

- **Ticket history is now fetched for a thousand tickets at a time**, where it used to be one request per ticket. Linking a large board for the first time now takes a handful of requests, so the worry about a first sync taking minutes is largely gone.
- **Tickets are asked for in two plain questions** ("changed lately" and "not yet resolved") where it used to be one combined question. There are reports of Jira returning too few tickets for that kind of combined question (not confirmed in the documentation itself); two plain questions cannot be affected.
- **When Jira asks the app to slow down**, the app now waits at least as long as Jira says (it could wait less before), a little longer at each try, and gives up until the next sync when Jira says its hourly allowance is used up.
- **A reopened ticket's rounds are put in time order by the app itself**, since the documentation does not promise the order they arrive in.
- **If two measurements carry the same name**, the app takes the one that belongs to the service desk.

The stand-in Jira used for building and testing was changed in the same way, so it still answers exactly as the documentation says the real one does.

**Still only visible at work** (open question W8), because Atlassian does not document them: what the four measurements are called on the company's Jira, how a satisfaction rating is written on a ticket, how status and label changes are named in a ticket's history, and whether the company's kind of API token works on the Jira address itself. One Test link and one Sync now on a real board answer all four. Until then the connection stays marked unproven; a wrong name leaves a figure empty, never wrong.

### 2026-11-21 M3 Performance from Jira done
The app now shows how each helpdesk vendor is performing, from its Jira tickets. Because the company's Jira cannot be reached from here, it runs on a stand-in Jira with invented boards and tickets; the real connection is written but has never run (see "Needs your attention").

What you can do in it:

- **Link a vendor to its Jira board (admin).** On Performance, press Link a board, choose the vendor and its board, and say whether a ticket's support level shows in its status or in a label, and which statuses or labels mean level 1, 2 and 3. Test link checks the board without saving, lists the statuses and labels it found and points out a misspelt one. Saving fetches the tickets at once.
- **Sync.** Tickets are fetched every hour by the app itself, and whenever anyone presses Sync now. Each board shows when it was last fetched and how many tickets changed. If a fetch fails, the page says why in plain words and the tickets and figures already there stay as they were.
- **A vendor's month.** Open a vendor from Performance (or from the new Performance tab in its panel on Vendors) to see five figures for the chosen month: first response, first-line closure, SLA breaches, backlog age and satisfaction, each with small bars for the last twelve months and a table of the same twelve months below.
- **The tickets behind a number.** Every number is a link. "5 late" opens exactly those five tickets, which can be searched and sorted.
- **Targets.** Any team member presses Set targets and types the targets from the contract. Every month then says met or missed, and a missed target says a service credit may apply. No amount is calculated.
- **Overview.** Performance lists every scored vendor that has a board with this month's figures against target, worst first, sortable by any column, for any month of the last two years. Scored vendors without a board are named underneath.

The sample data has three linked helpdesk vendors (one where escalation shows as a status, one as a label), one free board to try linking yourself, and a "flaky demo board" whose every second fetch fails, so you can see what a failure looks like.

How it was checked: an independent tester used the running app against all five requirements and the general ones, and recalculated the figures by hand and by script for 36 vendor-months from the ticket lists; all passed. An independent reviewer read the code and found two real defects, both fixed with a test each: a ticket deleted or moved in Jira would have stayed "open" here for ever and made the backlog look older every day, and a month before a board's first ticket showed a backlog of "0 days, target met". About fifteen smaller points from both were fixed as well, such as the Back button after choosing a month and the overview fitting a smaller window.

Needs your attention:

- **The Jira documentation could not be opened from here.** (Since done: see the entry above.) The Jira connection was written from general knowledge and proven only against the stand-in, built so that a wrong name gives empty figures, never wrong ones.
- **Three requirements were reworded slightly** to match what was built: any member may press Sync now and the schedule is hourly (J-2); whether a figure must be at least or at most its target follows from the metric (J-4); the overview covers scored vendors that have a board and names the others (J-5).

Decided on your behalf (see `docs/open-questions.md`, Q19 to Q27):

- Tickets are fetched every hour while the app runs.
- A ticket that never had a level 2 or level 3 status or label counts as solved by the first line.
- The backlog target is the age of the oldest open ticket; the SLA target is the share of tickets resolved late.
- Today's targets are applied to every month shown; earlier targets are in the vendor's history but not re-applied.
- Figures are rounded to one decimal and that rounded figure is judged, so 94.96% meets a 95% target.
- First response counts tickets for which Jira has an outcome; one still waiting within its time is left out until it has one.
- The overview opens on the running month, marked "so far".
- A vendor with scoring switched off cannot be linked to a board and shows no performance figures.

### 2026-11-21 M2 SOW delivery and money done
The app now follows what each SOW delivers and what it costs. What you can do in it:

- **Milestones.** On a SOW's page, add milestones with a due date, mark them delivered or cancel them. A late one says how many days late. On a fixed-price SOW a milestone can carry a payment amount, and the amounts can never add up to more than the budget.
- **Change requests.** Record an extension or a budget change as proposed, then approve or reject it. Approving moves the SOW's budget and end date, and the page keeps showing where the SOW started and where it is now.
- **Rate cards and consultants.** Each vendor has a Money tab with its day rates per role, each with a start date, so a new rate does not erase the old one. On a SOW you name the consultants and their role, and the page shows each one's current day rate.
- **Invoices.** Key in an invoice against a SOW (optionally against a milestone) or a subscription. The currency follows the agreement, and the same invoice number cannot be entered twice for one vendor.
- **Budget.** Every SOW shows budget, invoiced, remaining and the percentage used, as a meter. From 80% it is marked close to budget, and past 100% over budget; both also appear under the bell and on the warnings page.
- **Spend.** The Money section shows spend per month and per vendor for any period, in euros, in pounds, and together in euros. Both the overview and the invoice list download as a file for Excel.
- **Settings (admin).** One page sets the pound to euro rate and the warning thresholds: days before a notice deadline, days before a SOW ends, and the budget percentage. Changing the rate changes converted totals only, never an invoice.

The sample data now includes milestones, an approved extension, consultants, rates and invoices, so every screen has something to show.

How it was checked: an independent tester used the running app against all seven requirements and the general ones (keyboard use, empty screens, failed saves, dates, speed); all passed, and the figures on the spend page were added up by hand against the invoices. An independent reviewer read the code and found one real defect: after a change request was approved, the budget could still be typed over directly, which made "started at, now at" untrue. That is fixed, along with about fifteen smaller points from both, such as a confirmation before removing an invoice and clearer wording in the history.

Decided on your behalf (see `docs/open-questions.md`, Q12 to Q18):

- An invoice cannot be negative or dated in the future. A credit is handled by correcting or removing the invoice.
- Any team member may approve a change request; the history shows who did.
- Once a change request is approved, the SOW's budget and end date change only through further change requests.
- A milestone's amount is optional, and a milestone invoiced above its amount is marked, not refused.
- A consultant's rate may be in pounds on a euro SOW.
- The pound to euro rate starts at 1.17 until you set the real one in Settings.

Three requirements were reworded slightly to match what was built: milestone amounts are optional (M-1), the spend overview itself can also be exported (M-6), and the Renewals page and on-screen explanations follow the thresholds you set (M-7).

### 2026-11-21 M1 Vendors and agreements done
The app now holds your vendors and contracts. What you can do in it:

- **Vendors.** Add and edit vendors with their type, owner, contacts and status. The list can be searched, filtered and sorted, and a vendor opens in a panel beside the list. Each vendor shows whether its NDA and data processing agreement are in place, missing or expired. A vendor with a running agreement cannot be offboarded by accident.
- **Agreements.** Add an MSA, SOW, subscription, NDA or data processing agreement; the form only asks for what that kind needs. A SOW can sit under an MSA. Each agreement has a status (draft, in negotiation, out for signature, active, ended) and its own page with its documents and full history.
- **Documents.** Attach PDF, Word and Excel files to an agreement, download them and remove them.
- **Renewals.** Every subscription shows its notice deadline. The Renewals page lists what is overdue or coming up within 30, 60, 90 or 180 days. You record the decision (renew, renegotiate, terminate), and renewing can move the renewal date on to the next term.
- **Warnings.** The bell in the header counts what needs attention: notice deadlines, SOWs about to end or past their end date, and missing or expired paperwork. Each warning links to its record, and the dashboard lists the first few.
- **Export and import.** The agreement list downloads as a file that opens in Excel. An admin can fill an Excel template with vendors and agreements, see what each row would do before anything is saved, and import the rows that are fine. Importing the same file twice adds nothing.

The app comes with nine invented sample vendors so every screen and every kind of warning has something to show. They are clearly marked "(invented)" and are not loaded when the app runs at work.

How it was checked: as before, an independent tester used the running app against every requirement and an independent reviewer read all the code. They confirmed seven real defects and about thirty smaller points. The ones that mattered most: a vendor could be offboarded and then still have an agreement made active; the Excel import could misread an amount that came from a formula by a factor of a thousand; and the import preview could promise rows that the import then refused. All were fixed, each with a test that would catch it again, and re-checked.

Decided on your behalf (see `docs/open-questions.md`, Q6 to Q11):

- Renewing a subscription moves its renewal date and leaves the original start date.
- A SOW still marked active after its end date gets a red warning.
- An amount typed as 1.234 is read as one thousand two hundred and thirty-four; the form shows how it read the amount before you save.
- If two people edit the same record at the same moment, the last save wins.
- Amounts always show cents.

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
- Linking a board fetches its tickets while the admin waits. Since the documentation check this takes a handful of requests even for a large board (history is asked for a thousand tickets at a time, not ticket by ticket), so it should be seconds, not minutes. To be measured once at work.
- Jira connection, still to be seen at work (open question W8): the names of the four measurements on the company's Jira, how a satisfaction rating is written on a ticket, the names "status" and "labels" in a ticket's history, and whether the company's kind of API token works on the Jira address itself. One Test link and one Sync now on a real board answer all four.
- A board whose sync is switched off keeps its tickets beyond 24 months, since the clean-up runs with the sync.
- A reopened ticket is judged on its final resolution; an earlier late resolution of the same ticket is not counted.
- The median first response time leaves out tickets still waiting for an answer, so it reads slightly low while answers are slipping.
- Two people saving the same vendor's targets at the same moment: the last save wins for every metric.
- If Jira gains or renames a measurement, the app notices after a restart.
- Whether Databricks keeps the app running at night decides whether the hourly sync runs then (open question W9).
- A second branch from another session (`claude/adoring-curie-k6ewvw`) holds a wider spreadsheet import (contacts, rate cards, past invoices). It was started from M0, before M1 and M2, and is not part of the app yet. Decide whether to bring it in; it will need rework first.
- Search and sorting do not ignore accents: searching "beta" does not find "Béta", and "École" sorts after "Z".
- The app allows two agreements with the same vendor, kind and title; the import treats that combination as "already there".
- The date boxes in forms follow the browser's own date format, which may be month-first on some machines. Everything the app itself writes is day month year.
- A renewal term shorter than a year that starts on the 31st drifts to the 28th after passing through February.
- A person's name is taken at first sign-in and not refreshed if it later changes in the company directory.
- Removing a contact or a document happens at once; only invoices, consultants and rates ask "Really remove?" first.
- A cancelled milestone keeps its amount if the SOW is later switched to time and materials.
- The rate dialog shows one problem at a time when both the role and the rate are wrong.
- One older check (two admins demoting each other at the same instant) failed once in seven runs on the real database while the machine was busy, and passed every other time. To be watched; if it recurs it needs a proper look.
- Two people changing the same SOW at the very same moment has been reasoned through and guarded, but not tried with two real people.
- PDF export moved from M1 to M4, the first milestone that produces a PDF.
- Deploy the app once at work as a rehearsal (open question Q3). With M1 done there is now something real to try there.
