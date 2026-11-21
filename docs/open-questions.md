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
| Q28 | How much does each criterion count? | The five starting criteria count equally (weight 20 each). An admin changes the weights on the Criteria page. | M4 |
| Q29 | For which months does the AI write a proposal? | Only for a month that is over, so it is based on the whole month. The app writes last month's by itself; any member can ask for an earlier month with a button. | M4 |
| Q30 | Who may ask the AI for a proposal, and accept, change or reject one? | Any team member; the vendor's history shows who did. | M4 |
| Q31 | What does the AI suggest on a quarterly scorecard? | The average of the quarter's monthly proposals, rounded to a whole score, leaving out proposals someone rejected. It is shown as a suggestion; the criterion has no score until the reviewer accepts it or chooses another. | M4 |
| Q32 | When criteria change, what happens to scorecards? | A final scorecard keeps the criteria, weights and figures it was finalised with. A draft follows the new criteria. A scorecard an admin reopens follows today's criteria again. | M4 |
| Q33 | Who is the reviewer, and how many scorecards can a vendor have? | The person who starts the scorecard is its reviewer. One scorecard per vendor per quarter; the running quarter can already be started. | M4 |
| Q34 | What goes into the vendor PDF? | The overall score, each criterion's score, weight and comment for the vendor, the summary and the helpdesk figures. Internal notes, the facts about budgets and paperwork, and any mention of the AI stay out. | M4 |
| Q35 | How is "budget kept" worked out for a quarter? | What was invoiced on a SOW up to the end of the quarter, against its budget as it stands today. | M4 |
| Q36 | What happens to scorecards when a vendor's scoring is switched off? | They are kept but no longer shown, and come back if scoring is switched on again. | M4 |
| Q37 | How many tickets does the AI read for the themes? | The tickets created in the month, at most the newest 250. A theme needs at least two tickets; at most five themes are shown. | M4 |
| Q38 | Can a scorecard be removed? | A draft can, by any member, after asking once more. A final scorecard cannot. | M4 |
| Q39 | Letters outside Western European alphabets in the PDF | They print as a question mark for now, since the PDF's built-in letters do not cover them. Say if comments are ever written in another script. | M4 |
| Q40 | Can a scorecard be finalised while its quarter is still running? | No. It can be started and scored, and is finalised once the quarter has ended, so a final scorecard and its PDF always cover three whole months. | M4 |
| Q41 | Which SOWs get the "heading over budget" flag? | Every active SOW with a budget, fixed price and time and materials alike, once it has run 30 days. On a fixed-price SOW one large milestone invoiced early can raise the flag although nothing is wrong. Say if fixed-price SOWs should be left out. | M5 |
| Q42 | How is "invoicing rate points to an overrun" worked out? | What has been invoiced so far, spread evenly over the days since the start date and carried on to the end date. The flag names the day the budget would run out. | M5 |
| Q43 | What counts as "worsened three months in a row"? | Over the last four whole months each figure is worse than the month before, however small the step and also while the target is still met. The running month is left out. Say if a flag should only appear once the target is missed or the step is large. | M5 |
| Q44 | Does "a SOW ending within 30 days" follow the admin's setting? | Yes, the same number of days as the "SOW ending" warning. | M5 |
| Q45 | Which scorecards are "due this quarter"? | Those for the quarter that has just ended: every scored vendor in use without a final scorecard for it. | M5 |
| Q46 | For a past month, which figures does the monthly report show? | Invoices up to the month's last day, scorecards final for quarters ended by then, and the agreements that are active today with an end date in the 90 days after it, against budgets and targets as they are today. An agreement renewed or ended since is therefore not listed for an earlier month. The running month is shown up to today. | M5 |
| Q54 | What happens to a saved summary when the month's figures change afterwards? | The page marks it "Figures changed" and the PDF prints one line under it saying so, until someone saves the summary again. The summary is not removed or rewritten by the app. | M5 |
| Q47 | What if the report has more rows than fit on two pages? | The tables are shortened, each saying how many rows it leaves out. | M5 |
| Q48 | Do a briefing's figures change after it is made? | No. A briefing keeps the facts of the day it was prepared; for a later meeting a new one is prepared. | M5 |
| Q49 | How far ahead and back does a briefing look? | Dates in the next 180 days, the last three whole months of helpdesk figures, spend of the last twelve months. | M5 |
| Q50 | What of the AI's text is printed? | Only what a person has taken over or written. An AI summary or talking point nobody has accepted is never in a PDF. | M5 |
| Q51 | May the AI mention figures of its own? | No. It is given the app's figures and an answer quoting any other number is thrown away and asked for again. | M5 |
| Q52 | Who may prepare, change and remove a briefing, and write the report's summary? | Any team member; the history shows who did. | M5 |
| Q53 | Open RFPs on the dashboard and in the report | Every RFP that is not decided or cancelled, with its stage as it is today, the nearest decision date first. Also for a past month's report. | M5, M6 |
| Q55 | Do candidates see the criteria and their weights? | Yes: the Word document for a candidate lists the criteria with their weights and how much the written answers and the demo count. The budget, the sponsor and the need as written for the demand are left out. Say if weights should stay internal. | M6 |
| Q56 | What is the RFP template? | One built-in template: six sections (introduction, scope, timeline, how to respond, how responses are evaluated, confidentiality) and six criteria (functional fit 40, technology and security 25, implementation and support 20, commercial terms 15; demonstration 60, team and interview 40). Written answers count for 70% and demo for 30% unless changed in the demand. Say if the team's own template differs. | M6 |
| Q57 | What is the AI given to draft an RFP? | The title, the need and the date a decision is wanted. Not the budget and not the sponsor, since the document goes to vendors. It is told to reword the need for vendors and not to copy it; a budget or a name typed into the need itself could still find its way into a draft, so the draft is read before it is used. | M6 |
| Q58 | Can the document change after it was approved? | Not while it is approved: what is approved is what goes out. A member can take it back to drafting and change it; the earlier approval then stays in the trail as "approved an earlier version" but no longer counts, so a new approval is needed. Taking it back without changing anything keeps the approval. Say if any change, however small, should be allowed without a new approval. | M6 |
| Q59 | When is a requested change no longer "open"? | When a team member marks it as dealt with. The reviewer does not have to sign off again. | M6 |
| Q60 | Who may be a candidate, and who is issued the RFP? | Any vendor that is not offboarded, also an active one. Only shortlisted candidates are issued, each on its own day. A candidate added to the shortlist later can still be issued while the RFP runs. | M6 |
| Q61 | What counts as "an NDA in place" when issuing? | The vendor has an active NDA that has not expired, or does not require one. Otherwise the warning must be ticked, and the name of whoever ticked it is kept and printed in the decision record. | M6 |
| Q62 | How is an answer sheet matched? | By the number in the first column, provided the question in that row is still that question; otherwise by the exact wording of the question. A sheet handed out before the questions were renumbered therefore never puts an answer under the wrong question. Anything else is listed for a person to place or set aside. Uploading again replaces the answers it matches and keeps the rest. | M6 |
| Q63 | Does the AI compare by itself when answers arrive? | No. A member asks for the comparison, and asks again after more answers have come in; the page says when an answer changed since. It is asked once per criterion. | M6 |
| Q64 | What may the AI's comparison say? | Only what is in the answers: it may quote no number that is not there, and each proposed score must rest on a passage that occurs word for word in that candidate's answers. An answer that breaks this is thrown away and asked for once more. Demo criteria get no proposal. | M6 |
| Q65 | How are RFP scores added up? | Average per criterion across everyone who scored it; a part's score once every criterion in it has a score; overall from the two parts by their weights. Shown with two decimals, rounded once; candidates with the same rounded overall score share a place. | M6 |
| Q66 | Who scores, and can scores be seen? | Every team member, each for themselves; everyone sees everyone's scores and comments, and the decision record prints them per evaluator. A score can be changed or taken back until the decision. | M6 |
| Q67 | Can a decision be recorded before everything is scored? | Yes, with a notice that some candidates have no overall score. The winner must be a candidate the RFP was issued to. | M6 |
| Q68 | Can a decision be undone, or an RFP reopened? | No. A decided or cancelled RFP cannot be changed. Say if an admin should be able to reopen one. | M6 |
| Q69 | What happens to the vendor of the winner and of the others? | The winner becomes active (its own history says so). The others keep the status they had; nothing is offboarded or removed. | M6 |
| Q70 | Is the decision record available before the decision? | Yes, as the trail so far, and for a cancelled RFP with the reason. | M6 |
| Q71 | What can be asked about? | What the app's own pages show: vendors, agreements and renewals, SOW budgets, milestones and change requests, invoices and spend, helpdesk figures, scorecards, warnings and risk flags, RFPs, and the text of uploaded documents. Anything else gets "the app does not hold that". Not yet: briefings, the monthly report, single Jira tickets, the audit log and rate cards. Say which of these you miss. | M7 |
| Q72 | Is a conversation kept? | The conversation on screen lasts as long as the browser tab and is gone after "Start over" or closing the tab. Each question and its answer is also stored with who asked, the model and the prompt, so an answer can be traced later; there is no screen that lists them. Say if questions should not be stored, or if you want a history. | M7 |
| Q73 | Which numbers may an answer contain? | Only numbers the app looked up for that question, and numbers you typed in the question yourself (so "is it true we spent 1,000,000?" can be repeated back to you; the figures under the answer show what the app really holds). A date counts as a whole and an amount counts with its currency, so a day of the month can never pass as a count and pounds can never pass as euros. An answer with any other number is thrown away and asked for once more; after that the page says the AI could not answer. Counts and totals are always the app's own and are shown again under the answer with a link to the list. | M7 |
| Q74 | Which documents can be asked about? | PDF, Word (.docx) and Excel (.xlsx) files with real text in them, attached to an agreement or sent by an RFP candidate. A scan (a photo of paper) and the old .doc and .xls formats cannot be read; the agreement page says so next to such a file. Passages are found by the words they share with the question, not by meaning, so asking with the document's own words works best. | M7 |
| Q75 | How much of a long list does the AI read? | The first 40 rows. The count and the totals are of the whole list, and the answer says when only the first ones are listed. | M7 |
| Q76 | Does a follow-up question work? | Yes: the last three questions go along with a new one, so "and next quarter?" is understood. The earlier answers do not go along. | M7 |
| Q77 | What does the search field at the top find? | Vendors, agreements and RFPs by name, and the app's pages. Not invoices, people or tickets. Anything typed can be sent to Ask with Enter. | M7 |
| Q78 | A filter was added to the agreement list | "Ends from" and "Ends to" were added to the Agreements page, because "SOWs ending this quarter" needs a list that shows exactly those. | M7 |
| Q79 | Who may ask, and may everyone ask about everything? | Every team member, about everything the app holds, as on the pages themselves. Ask shows nothing a member could not open. | M7 |
| Q27 | How long are tickets kept? | 24 months after they were resolved, as the data model says. Open tickets are kept however old. | M3 |

## To check at work before M9

These cannot be answered from outside the company. None block the build.

| # | Check | Why |
|---|---|---|
| W1 | Does the workspace have Lakebase Autoscaling, or only Lakebase Provisioned? | Decides which database connection is used. The app assumes Autoscaling; the runbook says what to change for Provisioned. |
| W7 | Does Databricks install the build tools before building the app, and does the `postgres` resource supply the Lakebase endpoint as assumed in `app.yaml`? | Both are assumptions taken from documentation, not yet seen working. |
| W2 | Can a Databricks App reach Jira Cloud over the network? | Some workspaces block outbound connections; IT may need to allow Atlassian. |
| W3 | Does the Jira account allow an API token, and can it read every vendor board including SLA and satisfaction fields? | The sync needs it. |
| W4 | Which model serving endpoint should the app use, and may an app call it? | The AI features need one endpoint name. Once it is known, run the evaluation sets there (`npm run ai:eval`) to see how good the model's proposals are; until then only the stand-in has answered. For Ask this matters most: the stand-in only recognises common wordings, a real model reads the question. Each question is two calls to the model (a quick one to choose what to look up, a careful one to write the answer). |
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
