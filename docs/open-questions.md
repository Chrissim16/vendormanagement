# Open questions and working assumptions

Agents record here anything they decided on the owner's behalf. The owner corrects what is
wrong. Answered questions move to the bottom.

## Waiting on the owner

| # | Question | Working assumption until answered | Affects |
|---|---|---|---|
| Q1 | What is the app called? "Counterpart" was rejected as too plain. | No name; the header shows "Vendor Management". Easy to change at any time. | M0 |
| Q2 | Is an NDA required for every vendor, and a data processing agreement for every vendor? | Both are required by default and can be switched off per vendor. | M1 |
| Q3 | Should the app be deployed once at work straight after M0, as an early rehearsal? | Recommended, but the owner decides, since it uses work time. | M9 |
| Q4 | Can a personal Databricks trial workspace be used to rehearse deployment? | Not assumed. Without it, deployment is first tried at work. | M9 |
| Q5 | Which time zone does the team work in? Times on screen and "today" in filters use it. | Europe/Amsterdam. One setting to change. | All |
| Q6 | When a subscription is renewed, should the start date move to the new term or stay as the original start? | It stays; only the renewal date moves. | M1 |
| Q7 | A SOW that is still marked active after its end date: is a red warning right? | Yes, it is shown as "Past end date" until someone ends or extends it. | M1 |
| Q8 | In the import, who owns a row with no owner email? | The person doing the import. | M1 |
| Q9 | When recording "renew", the box "move the renewal date to the next term" is ticked by default. Right? | Yes. Otherwise a renewed subscription would never ask for a decision again. | M1 |
| Q10 | Two people editing the same vendor or agreement at once: the last save wins. Acceptable for five people? | Yes for now. | M1 |
| Q11 | An amount typed as 1.234 is read as one thousand two hundred and thirty-four, and the form shows "Read as € 1,234.00" before saving. Is that the right reading for you? | Yes, since a dot before three digits is how thousands are usually written here. | M1 |
| Q12 | Credit notes: can an invoice be negative? | No. An invoice amount is above zero; a credit is handled by correcting or removing the invoice. | M2 |
| Q13 | Can an invoice be dated in the future? | No. | M2 |
| Q14 | Who may approve a change request? | Any team member, like every other change. The history shows who did. | M2 |
| Q16 | After a change request is approved, can the SOW's budget or end date still be typed over directly? | No. From then on they change only through change requests, so "started at, now at" stays true. Before any approval they can be corrected freely. | M2 |
| Q17 | Must every milestone on a fixed-price SOW have an amount? | No, the amount is optional. A milestone invoiced above its amount is marked rather than refused. | M2 |
| Q18 | May a consultant's day rate be in pounds on a euro SOW? | Yes; the rate is shown in its own currency. Say if it should be refused instead. | M2 |
| Q15 | The pound to euro rate starts at 1.17 until an admin sets it. | Fine as a starting value; set the real one on the Settings page. | M2 |
| Q19 | How often should tickets be fetched from Jira? | Every hour while the app is running, plus "Sync now". One setting to change. | M3 |
| Q20 | A ticket that never had any of the listed level 2 or level 3 statuses or labels: which level is it? | Level 1, solved by the first line. Level 1 values are therefore optional on the board link. | M3 |
| Q21 | What exactly is the "backlog age" target, and the "SLA breaches" target? | Backlog: the oldest open ticket may be at most so many days old. SLA breaches: at most so many percent of the month's resolved tickets were late. | M3 |
| Q22 | When a target changes, should earlier months keep being judged by the old target? | No. Today's targets are applied to every month shown; the vendor's history shows when a target changed. | M3 |
| Q23 | Is a figure of 94.96% against a 95% target met or missed? | Met. Figures are shown with one decimal, and the figure as shown is the one judged, so the screen never contradicts itself. | M3 |
| Q24 | Which tickets count for "first response"? | Tickets created in the month for which Jira has an outcome. A ticket not yet answered but still in time is left out until it has one. | M3 |
| Q25 | Who may press "Sync now", and who may link a board? | Any team member may sync. Only an admin links a board or changes how it is read. | M3 |
| Q26 | Which month does the performance overview open on? | The running month, marked "so far". Earlier months are one choice away. | M3 |
| Q27 | How long are tickets kept? | 24 months after they were resolved, as the data model says. Open tickets are kept however old. | M3 |

## To check at work before M9

These cannot be answered from outside the company. None block the build.

| # | Check | Why |
|---|---|---|
| W1 | Does the workspace have Lakebase Autoscaling, or only Lakebase Provisioned? | Decides which database connection is used. The app assumes Autoscaling; the runbook says what to change for Provisioned. |
| W7 | Does Databricks install the build tools before building the app, and does the `postgres` resource supply the Lakebase endpoint as assumed in `app.yaml`? | Both are assumptions taken from documentation, not yet seen working. |
| W2 | Can a Databricks App reach Jira Cloud over the network? | Some workspaces block outbound connections; IT may need to allow Atlassian. |
| W3 | Does the Jira account allow an API token, and can it read every vendor board including SLA and satisfaction fields? | The sync needs it. |
| W4 | Which model serving endpoint should the app use, and may an app call it? | The AI features need one endpoint name. |
| W5 | Is there a Unity Catalog volume the app may write to? | Stores uploaded documents. |
| W8 | Does the company's own Jira use the names the app expects? On 21 Nov 2026 the Jira connection was checked against Atlassian's published documentation. **Confirmed:** the search call and how its pages follow each other, the call that lists Jira's fields, the board calls, the call for ticket history, the shape of a response-time (SLA) result, how times are written, and how Jira asks a caller to slow down. **Not in the documentation, so only visible at work:** (1) the names of the four measurements on your Jira ("Time to first response", "Time to resolution", "Satisfaction", "Satisfaction date"; these are Jira's standard names but a site can rename them); (2) exactly how a satisfaction rating is written on a ticket; (3) that a status or label change appears in a ticket's history under the names "status" and "labels"; (4) whether the kind of API token the company issues works on the Jira address itself (a newer "scoped" token may need a different address, which would show as a refused sign-in). Check all four with one "Test link" and one "Sync now" on a real board: Test link names any missing measurement, and a board whose tickets all show as "solved by the first line" would point to (3). | If a name differs, that figure stays empty instead of wrong; the fix is small but must be made. |
| W9 | Is the app kept running outside office hours? | The hourly Jira sync runs inside the app. If Databricks stops an idle app, the sync runs on the first visit instead, or the `jira-sync` command is scheduled as a Databricks job. |
| W6 | Who can grant the app's permissions to the five team members only? | Controls who can open the app. |

## Answered

| Date | Question | Answer |
|---|---|---|
| 2026-11-21 | The mockup's sample vendor names resembled real firms. | Replaced everywhere, in the mockup too, by the app's invented names. Every sample vendor's legal name says "(invented)". |
| 2026-11-21 | Who is it for? | The VS Finance team, at most 5 users. |
| 2026-11-21 | Roles? | Admin and member. No restricted role; everyone sees all contract values. |
| 2026-11-21 | Vendor kinds? | Software, consultancy, IT research and advisory. No hardware, telecom, facilities. |
| 2026-11-21 | Agreement kinds? | MSA (indefinite), SOW (main kind, project based), subscription (renews), NDA, data processing agreement. |
| 2026-11-21 | SOW detail? | Fixed price or time and materials, budget versus invoiced, milestones, change requests, named consultants, rate cards. No PO numbers, no days worked. |
| 2026-11-21 | Contract lifecycle? | A light status only. |
| 2026-11-21 | Spend? | Invoices keyed in by the owner against a SOW or subscription. No approval step. |
| 2026-11-21 | Currency? | EUR mainly, some GBP. EUR total with an admin-set rate. |
| 2026-11-21 | Jira? | Jira Cloud, Jira Service Management with SLAs. One board per vendor. Escalation by status or label. A service account exists. |
| 2026-11-21 | Metrics? | First response time, first-line closure rate, SLA breaches, backlog age, satisfaction. Monthly, with quarterly review. |
| 2026-11-21 | Service credits? | Flag only; calculation is on the backlog. |
| 2026-11-21 | AI priorities? | Scoring and briefings high; chat and risk flags medium; contract reading low. Suggest and confirm. May read ticket text. |
| 2026-11-21 | Which AI? | Models hosted in Databricks. |
| 2026-11-21 | Risk flags? | Operational warnings only, not contract clauses. |
| 2026-11-21 | Warnings? | 90 days notice, 30 days SOW end, 80% budget, NDA or DPA gaps. Inside the app only. |
| 2026-11-21 | RFP? | About 3 a year. Full process in the app; AI drafts, compares and proposes scores; outside reviewers get exports; vendors never get access; winner becomes a vendor, no draft contract. |
| 2026-11-21 | Reports? | Monthly management report for the IT management team; briefings on screen and PDF; scorecard PDF for vendors. |
| 2026-11-21 | Starting data? | The owner enters it; an Excel import is provided. |
| 2026-11-21 | Where is it built? | Outside the company, moved in through GitHub. Policy allows it. Work budget about 400 dollars. |
| 2026-11-21 | Language? | English only. |
