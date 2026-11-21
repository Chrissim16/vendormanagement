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
| Q6 | Sample vendor names in the mockup (Halden, Kestrel, Northgate and others) were meant as invented, but some resemble real firms. | They will be replaced by plainly invented names when sample vendors are added in M1. | M1 |

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
| W6 | Who can grant the app's permissions to the five team members only? | Controls who can open the app. |

## Answered

| Date | Question | Answer |
|---|---|---|
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
