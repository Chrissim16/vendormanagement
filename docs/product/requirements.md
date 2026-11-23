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
- A long history does not push a page's content down: on a page with tabs it has its own History tab, the last one; elsewhere the newest five entries are shown with "Show all" (added after M8, built in M10).

**F-5 Sample version.** The app can be tried with invented data only, without anything from the company.
- On one's own computer, one command starts it with the sample data, fresh every time; nothing is kept when it stops.
- It listens beyond that computer only when one shared password is set (at least 12 characters, set where the app runs, never stored in the project). Then nothing is served without the password: no page, no data, no file. Ten wrong passwords from one address close it for that address for ten minutes.
- Behind the password every page says that this is a sample version with invented data and that real company data must not be entered.
- The password setting is refused inside Databricks, where people sign in with their company account.
- Not built: a hosted sample version on a link. Tried on 22 Nov 2026 for Render: with its built-in database the app needs 600 to 800 MB of memory, more than the free plan's 512 MB; with a separate Postgres database it needs under 200 MB. The owner chose to run it on their own computer instead.

**F-4 System check.**
- An admin page tests each connection (database, sign-in identity, file storage, Jira, AI model) and shows per connection: working or not, and if not, a plain-language cause and what to do.
- It runs the same against the stand-ins used during the build and against the real services.

## Vendors and agreements (M1)

**V-1 Vendor list.** Shows name, type, status, owner, number of active agreements and any warning. Searchable by name; filterable by type, status and owner; sortable; filters survive a reload. Offboarded vendors are hidden unless asked for.

**V-2 Add and edit a vendor.** Required fields are enforced next to the field. A duplicate name (ignoring case and spaces) is refused. Scoring, NDA required and DPA required can be switched per vendor.

**V-3 Vendor page.** Shows details, contacts (one primary), agreements grouped by kind, and sections for money, performance and RFPs that fill in later milestones. Shows clearly whether an NDA and a DPA are in place, missing or expired.

**V-4 Offboarding.** Refused while the vendor has an active agreement, naming the agreement.

**V-5 Address and VAT number.** Added after M8 at the owner's request; built in M10.
- The vendor form has an address in separate boxes (street, a second street line, postal code, city, country) and a "VAT or tax number". All are optional, for every status.
- The VAT or tax number takes letters, digits, spaces, dots and dashes, and is stored in capitals without spaces, dots or dashes. A number already held by another vendor is refused next to the field, naming that vendor.
- The vendor page shows the address as one block and the number, or "Not given".
- The import template has the same columns, all optional, by the same rules.

**V-6 Main contact when adding a vendor.** Added after M8; built in M10.
- The form for a new vendor has an optional "Main contact" part: name, roles, email and phone.
- When a name is given, the vendor and the contact are saved together and the contact is the vendor's primary contact. When the contact is refused (for example an invalid email), nothing is saved and the form keeps what was typed.
- With nothing filled in, the vendor is saved without contacts, as before. An email, phone or role filled in without a name is pointed out under the name ("Give the contact a name.") and nothing is saved, so nothing typed is dropped without a word. Further contacts are added on the vendor's page.

**V-7 Contact roles.** Added after M8; built in M10. Replaces the free-text job title.
- A contact has any number of roles, chosen from one shared list, shown A to Z.
- The list starts with Account Manager, Billing / Finance, Consultant, Delivery Manager, Developer, Executive Sponsor, Helpdesk, Legal / Contracts, Program Manager, Project Manager, Support Manager and Technical Contact.
- While filling in a contact, a member can type a role that is not on the list and add it; it is then on the list for everyone. A role that differs from an existing one only in capitals or in extra spaces (before, after, or doubled between words) is not added twice; the existing one is chosen. "Help desk" and "Helpdesk" are different names. Text typed in the box but not confirmed with Enter is taken as a role when the box is left.
- An admin can rename a role and remove one. A role in use cannot be removed; the page names the contacts that hold it. Renaming changes it on every contact.
- Every job title held before becomes a role on the list and on its contact, so nothing typed earlier is lost.
- The vendor's contacts show their roles, and so does Ask's vendor look-up.

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
- From the dashboard, the record a warning is about is two clicks away (the kind, then the warning), and its edit form three.
- A missing or expired NDA or DPA leads to the one being worked on (draft, in negotiation or out for signature), the one closest to signed first, and the warning names it and its status. With none under way, an expired one leads to the expired agreement, and a missing one opens the form to add one for that vendor with the kind already chosen.

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

**M-6 Spend overview.** Spend per vendor and per month for a chosen period, as a EUR total marked as converted, with the amounts in their own currencies alongside (see M-8 for how). The overview itself can be exported as CSV, and the invoices behind it can be listed, filtered and exported as CSV.

**M-7 Warning thresholds.** An admin sets how many days ahead to warn of a notice deadline and of a SOW ending, and at what percentage of a budget to warn. Warnings, the Renewals page and the explanations on screen all follow these settings. (Exchange rates were part of M-7 until 22 Nov 2026 and are now M-8.)

**M-8 Currencies and exchange rates.** Euro is the main currency; amounts can be in any currency on the admin's list, and every total across currencies is in euros. Built in M12.
- The list starts with EUR, GBP, USD, SEK, NOK and DKK. On the Settings page an admin can add any other currency that uses cents (two decimals), chosen from the standard currency list, by giving its rate. A currency without cents or with three decimals (for example yen or dinar) is refused with a plain explanation.
- Each currency other than EUR has one current rate, typed as "1 EUR = X" with up to four decimals, as banks and the European Central Bank publish them. EUR itself is always 1 and cannot be removed or changed.
- Settings shows, per currency, the rate and when and by whom it was last set. Until an admin saves a rate, the app uses a rough starting rate and says "starting rate, not yet set by an admin" there and next to every euro total that uses it.
- A currency can be removed only while no agreement, rate card line or RFP uses it; otherwise the page says what still uses it. Adding, changing and removing a currency or a rate are in the audit log.
- Agreements, rate card lines, RFP budgets and the Excel import accept any currency on the list, and nothing else. An invoice is always in its agreement's currency, as before, so a SOW's budget against invoiced is never converted.
- Every total across currencies (Money page, dashboard, monthly report, briefing, Ask) is one euro total marked as converted, with a line beneath it naming the amount in each currency that appears in it, for example "€ 120,000.00 · $ 30,000.00 · SEK 85,000.00". Lists show each amount in euros, with the original in brackets where it was not in euros.
- Changing a rate changes converted totals only; no stored amount changes. A briefing keeps the figures and rates of the day it was made. The monthly report is worked out afresh, at the current rates, like all its figures, and says when they have changed since its summary was written (D-2).
- Amounts are shown with € for euros, £ for pounds and $ for US dollars, and with the code for every other currency (SEK 85,000.00), so kronor of different countries cannot be confused.
- Contract reading (E-1) and Ask (C-1) recognise amounts in every currency on the list. An amount in a currency not on the list, or written only as "kr" without saying which kronor, is left out and named as left out.

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

**Q-3 Review.** The RFP exports as Word (since M11 no longer as PDF; see Q-14). A member records each reviewer's sign-off or requested changes, and marks a requested change as dealt with. The stage cannot move to approved without at least one approval and no open change request. An approved document is fixed; when it is taken back and changed, the earlier approval no longer counts.

**Q-4 Candidates.** A member keeps a longlist and shortlist with a reason per candidate. A candidate not yet known is created as a prospect vendor.

**Q-5 Issue.** For each shortlisted candidate the app exports the RFP as Word and the question list as an Excel answer sheet; neither holds the budget or the sponsor. Issuing to a candidate without an NDA in place shows a warning that must be acknowledged. Once issued, questions, criteria and the weights of the two parts are locked for good.

**Q-6 Responses.** A member uploads a candidate's filled answer sheet. The app matches answers to questions by number and wording, never onto a question the row was not written for, and shows any it could not match for manual entry. Other response documents can be attached.

**Q-7 AI comparison.** Per question the AI summarises each candidate's answer and the differences between them, and proposes a score per candidate and criterion with a reason that quotes the answer. The proposal gives no score by itself, and the page says when an answer has changed since.

**Q-8 Scoring.** Each team member can score each candidate per criterion, including demo and interview criteria. The app shows the average per criterion, the weighted written and demo scores, the overall score and the ranking.

**Q-9 Decision.** A member records the winner and the rationale. The winner becomes an active vendor; no agreement is created. Other candidates stay prospects. After the decision nothing on the RFP changes.

**Q-10 Decision record.** The full trail (demand, sign-offs, candidates with reasons, scores per evaluator, decision) exports as one PDF. Before a decision it holds the trail so far.

**Q-11 Overview.** A list of RFPs with stage, owner and target date, and a page per RFP that shows the current stage and the next step. The RFP's history is on its own History tab after Decision, at every stage (changed after M8; built in M10).

**Q-12 Document editor.** Added after M8 at the owner's request; built in M11.
- A section's text is edited in an editor with headings, bullet and numbered lists, bold, italic and simple tables, using the keyboard as well as buttons. The AI's draft arrives in the same formatting.
- What the editor shows is what the Word file holds: the same headings, lists, emphasis and tables.
- Text written before M11 opens unchanged, as plain paragraphs.
- On a section a member can ask the AI to rewrite it, with an instruction in their own words, or for one or more reviewer comments (Q-13). The rewrite is shown next to the current text with the differences marked, labelled as AI, and changes nothing until the member uses it, edits it, or rejects it. It may contain no figure that is not in the section, the comments or the instruction.
- Rewriting follows the same locks as editing: not on an approved, issued, decided or cancelled RFP.

**Q-13 Review rounds with comments from Word.** Added after M8; built in M11. Reviewers stay in Word.
- Downloading the review copy starts a review round with the next version number (version 1, 2, ...). The version is on the cover page and in the file name.
- A member uploads a reviewer's returned Word file to that round. The app reads its comments and tracked changes, with the reviewer's name as Word gives it, and places each next to the section it is in. One round takes the files of several reviewers.
- A comment shows the words it was made on. A tracked change shows as a suggested edit: what would be removed and what would be added.
- For each comment or suggested edit the member can: take the suggested edit over, ask the AI to rewrite the section for it, edit by hand, or set it aside. Each ends as "dealt with" or "set aside", with who and when.
- A suggested edit whose words are no longer in the section (because the text changed since) cannot be taken over as it is; the page says so and shows it for doing by hand. A comment the app cannot place in a section, for example because a reviewer renamed a heading, is listed under "Not placed" for the member to put in a section or set aside.
- An uploaded file that is not a review copy of this RFP, or of another version, is refused or flagged with which version it is.
- The RFP cannot move to approved while a comment or suggested edit of any round is open, as with a requested change.
- Downloading the next review copy holds every change made since. Earlier versions stay downloadable from their round, with their comments and what was done with each.

**Q-14 Company Word template.** Added after M8; built in M11.
- An admin uploads the company's Word template (.dotx or .docx) on the settings page. On upload the app says what it found: the cover page and the places marked [Title], [Date] and [Version], the header and footer, and the heading and list styles. A missing mark is reported, not refused.
- Every RFP Word file (the review copy and the copy each candidate gets) uses the template's cover page, header and footer, logo, fonts and spacing; the RFP's own text uses the template's heading, list and table styles. The cover gets the RFP title, the day the file was made and the version.
- The template's own words other than the marks are kept as they are; the RFP's text follows the cover page.
- A new upload replaces the template for files made from then on. Without a template the app uses a plain layout of its own. The project holds only an invented example template for trying the app, never the company's.
- The RFP is no longer exported as PDF for review. The decision record (Q-10) stays a PDF.

## Ask a question (M7)

**C-1 Chat.**
- A member asks a question in plain language about vendors, agreements, money, performance or RFPs and gets an answer with links to the records used.
- Counts and amounts in an answer match what the list pages show for the same filter.
- If the app does not hold the answer, it says so instead of guessing.
- Questions about the content of an uploaded document are answered with the document and passage named.
- The chat cannot change any data.
- Under each answer the page shows what the app looked up, with its own count and totals and a link to the list page with the same filter, so every figure can be checked in one click.
- The search field in the top bar finds vendors, agreements, RFPs and pages by name, and takes a typed question to Ask.
- The agreement list can also be filtered by the period the end or renewal date falls in ("Ends from", "Ends to"), which is what "SOWs ending this quarter" links to.

## Contract reading (M8)

**E-1 Extraction.** After uploading a contract document, a member can ask the AI to propose field values (kind, title, dates, notice period, value or budget, currency). Each proposed value shows the passage it came from, and nothing is saved until the member confirms.
- The proposal is shown on the agreement's page next to what the agreement holds now, field by field, with the passage word for word and the page it stands on.
- The member ticks the values to use; only those are saved, through the same rules as the edit form. If any is refused, nothing is saved and the page says why.
- A value is proposed only when the document states it and the passage shown contains it. What the document does not say is listed as not found; a value the AI gave without a passage that states it is left out and listed as left out.
- The kind is compared but never changed. A field the agreement's kind does not have is shown as not applying.
- The proposal can be rejected, and the AI can be asked to read again. What was done with a proposal, by whom and when, stays visible and is in the agreement's history.
- A document without readable text cannot be read by the AI, and the page says so.

## Throughout

**X-1** Every page works with the keyboard alone and passes automated accessibility checks.
**X-2** Empty lists explain what belongs there and offer the action to add the first item.
**X-3** A failed save keeps what was typed and says what went wrong.
**X-4** Dates are shown as day month year, for example 21 Nov 2026.
**X-5** Every page loads within 2 seconds with the volumes in section 12 of the PRD.
**X-6** No real company, vendor, person or ticket data appears anywhere in the repository; sample data is invented.
