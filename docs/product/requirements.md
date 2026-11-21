# Requirements

Each requirement has an ID and acceptance criteria. It is met when every criterion can be
demonstrated in the running app. Background is in `prd.md`; fields and rules in
`domain-model.md`; milestones in `../plan/implementation-plan.md`.

Roles: **admin** and **member**. Members can do everything except what is marked admin.

## Foundation (M0)

**F-1 Sign-in.**
- The header shows the signed-in person and their role, with no separate login.
- A first-time visitor becomes a member. The bootstrap admin email becomes an admin.
- A deactivated user sees a "no access" page and can do nothing.

**F-2 Admin.**
- An admin can change roles and deactivate users. The last active admin cannot be demoted or deactivated.
- A member sees no admin pages and is refused when calling an admin endpoint directly.

**F-3 Audit trail.**
- Every create, change and removal of a business record adds an entry with who, when and what changed.
- Each record's page shows its history. Admins can browse and filter the full log.

**F-4 System check.**
- An admin page tests each connection (database, sign-in identity, file storage, Jira, AI model) and shows per connection: working or not, and if not, a plain-language cause and what to do.
- It runs the same against the stand-ins used during the build and against the real services.

## Vendors and agreements (M1)

**V-1 Vendor list.** Shows name, type, status, owner, number of active agreements and any warning. Searchable by name; filterable by type, status and owner; sortable; filters survive a reload. Offboarded vendors are hidden unless asked for.

**V-2 Add and edit a vendor.** Required fields are enforced next to the field. A duplicate name (ignoring case and spaces) is refused. Scoring, NDA required and DPA required can be switched per vendor.

**V-3 Vendor page.** Shows details, contacts (one primary), agreements grouped by kind, and sections for money, performance and RFPs that fill in later milestones. Shows clearly whether an NDA and a DPA are in place, missing or expired.

**V-4 Offboarding.** Refused while the vendor has an active agreement, naming the agreement.

**A-1 Add an agreement.**
- A member can add an MSA, SOW, subscription, NDA or DPA to a vendor. The form shows only the fields for that kind.
- A SOW can be placed under an MSA of the same vendor, or left without one.
- An MSA has no end date. A SOW needs start, end, pricing and budget. A subscription needs renewal date, notice period and annual value.
- An end date before the start date is refused.

**A-2 Status.** A member can move an agreement through draft, in negotiation, out for signature, active and ended. Active requires the signed date. Ended requires a reason.

**A-3 Agreement list.** All agreements with vendor, kind, title, status, end date, owner and value or budget. Filterable by kind, vendor, status and owner; sortable; exportable as CSV.

**A-4 Agreement page.** Shows all details, the parent MSA or the SOWs underneath, documents and history.

**A-5 Documents.** A member can upload PDF, Word and Excel files up to 25 MB to an agreement, download them and remove them. Other file types are refused.

**A-6 Renewals.**
- A subscription shows its notice deadline and renewal state.
- A renewals page lists subscriptions whose notice deadline has passed or falls within the warning window, soonest first, overdue ones distinct.
- A member can record renew, renegotiate or terminate. Renew offers to roll the dates forward. A decided subscription leaves the list.

**A-7 Warnings.** A warnings page, and a count in the header, list: notice deadlines due or overdue, SOWs ending within 30 days or already past their end date while still active, and active vendors with a required NDA or DPA missing or expired. Each warning links to its record.

**A-8 Import.** An admin can download an Excel template, fill in vendors and agreements, and upload it. A preview shows valid rows and the reason for each invalid one before anything is saved. Importing the same file twice creates no duplicates.

## SOW delivery and money (M2)

**M-1 Milestones.** A member can add, edit, deliver and cancel milestones on a SOW. Fixed-price milestones can carry an amount, and the total may not exceed the budget. A milestone invoiced for more than its amount says so. Late milestones are marked.

**M-2 Change requests.** A member can record a change request with a budget change and a new end date. Approving it updates the SOW's budget and end date, and the SOW page shows original and current values with the changes in between.

**M-3 Consultants and rate cards.** A member can keep a rate card per vendor (role, day rate, valid from) and name consultants on a SOW with a role from that card. The SOW shows each consultant's current day rate.

**M-4 Invoices.**
- A member can key in an invoice against a SOW or subscription, optionally against a milestone.
- A repeated invoice number for the same vendor is refused. The currency must match the agreement.
- Amounts are typed as normal amounts and shown with their currency.

**M-5 Budget view.** A SOW shows budget, invoiced, remaining and percentage used. At 80% or more it appears on the warnings page; over 100% is marked as overrun.

**M-6 Spend overview.** Spend per vendor and per month for a chosen period, in each currency and as a EUR total marked as converted. The overview itself can be exported as CSV, and the invoices behind it can be listed, filtered and exported as CSV.

**M-7 Exchange rate and warning thresholds.** An admin sets the GBP to EUR rate; changing it changes converted totals only. The same page sets how many days ahead to warn of a notice deadline and of a SOW ending, and at what percentage of a budget to warn. Warnings, the Renewals page and the explanations on screen all follow these settings.

## Performance from Jira (M3)

**J-1 Board link.** An admin can link a vendor to its Jira board, choose how escalation is recognised (status or label) and which values mean level 1, 2 and 3, and test the link.

**J-2 Sync.** Tickets are fetched for each linked board on a schedule (every hour while the app runs) and on demand with "Sync now", which any member may press. The page shows when the last sync ran, how many tickets were updated, and any failure in plain language. A failed sync leaves existing data intact.

**J-3 Monthly metrics.** For each linked vendor and month the app shows the five metrics as defined in the domain model, with a 12-month trend. Each number opens the list of tickets behind it.

**J-4 Targets.** A member can set a target per vendor and metric; whether the figure must be at least or at most the target follows from the metric. Each month shows met or missed, and a missed target shows that a service credit may apply.

**J-5 Performance overview.** All scored vendors that have a Jira board with this month's metrics against target, sortable, with missed targets highlighted. Another month can be chosen, and scored vendors without a board are named.

## Scorecards and AI scoring (M4)

**P-1 Monthly proposal.** For each linked vendor and each month that is over, the AI proposes a score per measured criterion, with a written reason and the metric values it used, and a summary of recurring ticket themes with example tickets. It is labelled as an AI proposal. Last month's proposal is written by the app itself; any member can ask for an earlier month's.

**P-2 Quarterly scorecard.** A member starts a scorecard for a quarter. Measured criteria come with a suggested score from the monthly proposals, shown as a suggestion until the reviewer accepts it or chooses another. Manual criteria are scored by the reviewer, with supporting facts shown (budgets kept, milestones on time, NDA and DPA status). Each criterion takes a comment for the vendor and an internal note.

**P-3 Finalise.** Finalising requires the quarter to be over and every criterion scored. A final scorecard is read-only. An admin can reopen it.

**P-4 Vendors without Jira.** A scored vendor without a board gets the same scorecard, with all criteria scored by hand and the supporting facts shown.

**P-5 Not scored.** A vendor with scoring switched off has no scorecards and does not appear in performance views.

**P-6 Vendor PDF.** A final scorecard exports as a PDF with scores, vendor comments and the metrics, and without internal notes.

**P-7 Criteria.** An admin can add, weight and deactivate criteria. Final scorecards do not change when criteria change.

**AI-1 Suggest and confirm.** Nothing the AI produces takes effect until a person accepts or edits it. Every AI output shows that it is AI-written, when, and whether it was accepted, edited or rejected.

**AI-2 Failure.** If the AI is unavailable or returns something unusable, the page says so and every task can still be completed by hand.

## Briefings, risk flags, dashboard, report (M5)

**B-1 Vendor briefing.** From a vendor page a member prepares a briefing covering agreements and upcoming dates, spend against budget, performance and trend, missed targets, open milestones and change requests, risk flags and suggested talking points. Every figure matches the app's data on the day it was prepared, and the briefing keeps those figures afterwards. The AI suggests a summary and talking points; they become part of the briefing when a member uses them, and can be edited, saved and exported as PDF.

**R-1 Risk flags.** The warnings page also shows: a SOW whose invoicing rate points to an overrun before its end date; a vendor whose metric has worsened three months in a row; a SOW ending within the SOW warning window (30 days unless an admin changed it) with open milestones. Each flag states the facts that triggered it.

**D-1 Dashboard.** The landing page shows warnings and risk flags by type, SOWs by budget used, spend for the last 12 months, vendor scores with trend, scorecards due this quarter and open RFPs. Each item links to the detail.

**D-2 Monthly management report.** A member generates a one to two page PDF for a chosen month with spend against budgets, agreements ending in the next 90 days, vendor scores with trend, missed SLA targets and open RFPs with their stage. An AI-written summary paragraph can be edited before export; it is printed only once a member has used or written it, and the report says so when the month's figures have changed since.

## RFP (M6)

**Q-1 Demand.** A member creates an RFP with the need, budget, sponsor, approval date and target decision date.

**Q-2 Draft.** The AI drafts sections, criteria with weights and a numbered question list from the need and a template. The draft is a proposal: it becomes the RFP's document when a member takes it over, and a member can edit everything. Each question belongs to one criterion. Weights within a part add up to 100. Without the AI, the template gives the same start by hand.

**Q-3 Review.** The RFP exports as Word and PDF. A member records each reviewer's sign-off or requested changes, and marks a requested change as dealt with. The stage cannot move to approved without at least one approval and no open change request. An approved document is fixed; when it is taken back and changed, the earlier approval no longer counts.

**Q-4 Candidates.** A member keeps a longlist and shortlist with a reason per candidate. A candidate not yet known is created as a prospect vendor.

**Q-5 Issue.** For each shortlisted candidate the app exports the RFP as Word and the question list as an Excel answer sheet; neither holds the budget or the sponsor. Issuing to a candidate without an NDA in place shows a warning that must be acknowledged. Once issued, questions, criteria and the weights of the two parts are locked for good.

**Q-6 Responses.** A member uploads a candidate's filled answer sheet. The app matches answers to questions by number and wording, never onto a question the row was not written for, and shows any it could not match for manual entry. Other response documents can be attached.

**Q-7 AI comparison.** Per question the AI summarises each candidate's answer and the differences between them, and proposes a score per candidate and criterion with a reason that quotes the answer. The proposal gives no score by itself, and the page says when an answer has changed since.

**Q-8 Scoring.** Each team member can score each candidate per criterion, including demo and interview criteria. The app shows the average per criterion, the weighted written and demo scores, the overall score and the ranking.

**Q-9 Decision.** A member records the winner and the rationale. The winner becomes an active vendor; no agreement is created. Other candidates stay prospects. After the decision nothing on the RFP changes.

**Q-10 Decision record.** The full trail (demand, sign-offs, candidates with reasons, scores per evaluator, decision) exports as one PDF. Before a decision it holds the trail so far.

**Q-11 Overview.** A list of RFPs with stage, owner and target date, and a page per RFP that shows the current stage and the next step.

## Ask a question (M7)

**C-1 Chat.**
- A member asks a question in plain language about vendors, agreements, money, performance or RFPs and gets an answer with links to the records used.
- Counts and amounts in an answer match what the list pages show for the same filter.
- If the app does not hold the answer, it says so instead of guessing.
- Questions about the content of an uploaded document are answered with the document and passage named.
- The chat cannot change any data.

## Contract reading (M8)

**E-1 Extraction.** After uploading a contract document, a member can ask the AI to propose field values (kind, title, dates, notice period, value or budget, currency). Each proposed value shows the passage it came from, and nothing is saved until the member confirms.

## Throughout

**X-1** Every page works with the keyboard alone and passes automated accessibility checks.
**X-2** Empty lists explain what belongs there and offer the action to add the first item.
**X-3** A failed save keeps what was typed and says what went wrong.
**X-4** Dates are shown as day month year, for example 21 Nov 2026.
**X-5** Every page loads within 2 seconds with the volumes in section 12 of the PRD.
**X-6** No real company, vendor, person or ticket data appears anywhere in the repository; sample data is invented.
