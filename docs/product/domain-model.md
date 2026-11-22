# Domain model

Fields marked `*` are required. Every table also has `id`, `created_at`, `created_by`,
`updated_at`, `updated_by`, except records that are never edited after they are written
(renewal decisions, documents, audit entries), which only record who created them and when. Records are ended or archived, not deleted, unless stated.

## People and settings

**User**: `email*` (unique, lower case, from sign-in), `display_name`, `role*` (admin | member), `active*`.
- Created as `member` on first sign-in. The `BOOTSTRAP_ADMIN_EMAIL` address becomes `admin`.
- There is always at least one active admin. If the app is ever found without one, the `BOOTSTRAP_ADMIN_EMAIL` person is made admin at their next visit.
- The deployed app refuses to start unless `BOOTSTRAP_ADMIN_EMAIL` is a real address.

**Settings** (admin): `gbp_to_eur_rate*`, warning windows (`notice_days` 90, `sow_end_days` 30, `budget_warning_pct` 80), scorecard criteria.

## Vendors

**Vendor**: `name*` (unique, ignoring case), `legal_name`, `type*` (software | consultancy | advisory),
`status*` (prospect | active | on_hold | offboarded), `owner_user_id*`, `website`, `address_line1`, `address_line2`, `postal_code`, `city`, `country`, `vat_number`, `description`, `notes`,
`scoring_enabled*` (default yes), `nda_required*` (default yes), `dpa_required*` (default yes).
- A vendor with an active agreement cannot be offboarded.
- An offboarded vendor cannot receive new agreements, and none of its agreements can be made active. Every other status can, so a prospect can sign an NDA.
- Names are stored with extra spaces removed and compared ignoring case.
- The owner must be a person who has access to the app.
- RFP candidates are vendors with status `prospect`.
- Changes to a vendor's contacts are recorded in the vendor's history.
- `vat_number` (V-5) is optional and stored in capitals without spaces, dots or dashes. When given, no other vendor holds the same one.
- A vendor added with a main contact (V-6) is saved with that contact, as primary, in one transaction, or not at all.

**Contact**: `vendor_id*`, `name*`, `roles` (any number of contact roles), `email`, `phone`, `is_primary*`. At most one primary per vendor. The free-text `job_title` was replaced by roles in M10; each title held then became a role.

**Contact role** (V-7): `name*` (unique ignoring case and extra spaces). Shown A to Z. Any member adds one; an admin renames or removes one, and one in use cannot be removed. Adding, renaming and removing are recorded in the audit log. Not the same as a rate card role, which is a consultant's role and day rate.

**Rate card line**: `vendor_id*`, `role*`, `day_rate_minor*`, `currency*`, `valid_from*`. The current rate for a role is the latest line not in the future.

## Agreements

One table, with a `kind`.

**Agreement**: `vendor_id*`, `kind*` (msa | sow | subscription | nda | dpa), `title*`, `reference`,
`status*` (draft | in_negotiation | out_for_signature | active | ended), `owner_user_id*`,
`signed_on`, `start_date`, `end_date`, `currency*` (EUR | GBP), `notes`, and per kind:

| Kind | Extra fields | Rules |
|---|---|---|
| msa | none | No end date; runs until ended by hand. |
| sow | `parent_msa_id`, `pricing*` (fixed | time_and_materials), `budget_minor*`, `start_date*`, `end_date*` | Parent must be an MSA of the same vendor. Not subject to renewal. |
| subscription | `annual_value_minor*`, `end_date*` (renewal date), `notice_period_days*` (default 90), `auto_renews*`, `renewal_term_months` | Has a notice deadline. |
| nda, dpa | `signed_on` (required once active), `end_date` (valid until, optional). No start date | Counts as in place when active and not past `end_date`. One that has been set to ended counts as missing, not expired. |

- `signed_on*` is required once status is `active`, for every kind. A subscription also needs its `start_date*` then. An NDA or data processing agreement being negotiated has no signing date yet.
- `end_date` is on or after `start_date`.
- `ended` needs an end reason: completed, expired, terminated or replaced. The reason is cleared when the agreement is no longer ended.
- The vendor and the kind of an agreement cannot be changed after it is created.
- Fields that do not belong to the kind are always empty: an MSA never holds a budget or a notice period.
- A subscription without a stated notice period gets 90 days, and without a stated renewal term gets 12 months.

Derived, not stored:
- **Notice deadline** (subscription) = `end_date` minus `notice_period_days`.
- **Renewal state** (subscription): overdue, due soon (within `notice_days`), ok.
- **SOW budget** = original `budget_minor` plus approved change requests. **Invoiced** = sum of its invoices. **Used %** = invoiced / budget.
- **Compliance gap** (vendor): active vendor with `nda_required` and no NDA in place, or `dpa_required` and no DPA in place.

**Renewal decision**: `agreement_id*` (subscription), `decision*` (renew | renegotiate | terminate), `decided_on*`, `decided_by*`, `notes`, `term_end_date*` (the end date of the term it was made for).
- Only for an active subscription, at most one per term, and not dated in the future.
- It clears the warning for that term.
- `renew` can roll forward: the renewal date moves on by the renewal term and the start date stays as it was, which opens the next term for its own decision later.
- `terminate` does not end the agreement by itself; someone sets it to ended when it stops.

**Document**: attached to an agreement, or to a candidate's response in an RFP; never both. `title*`, `file_name*`, `content_type*`, `size_bytes*`, `storage_key*`, `extracted_text`. PDF, Word and Excel only, 25 MB at most, judged by the file's content as well as its name. The stored file's name is generated, so nothing a person typed becomes part of a file path. Attaching and removing are recorded in the agreement's history.
- `reading_suggestion_id`: the AI's current reading of the document's fields (E-1), when one was asked for. Which reading is current is written here; earlier ones stay as AI suggestions.
- `extracted_text` holds the words in the file, read when it is attached, so that Ask can find passages in it (C-1): a PDF gives one part per page, a workbook one part per sheet, a Word file (.docx) one part, without text deleted under tracked changes. Empty when the file holds no words the app can read (a scan, an old .doc or .xls); absent only for a document attached before the app could read text, which the app reads at its next start. Reading never refuses an upload.

**Warning** (worked out, not stored), for A-7:

| Warning | When | Shown as |
|---|---|---|
| Renewal overdue | Active subscription, notice deadline passed, no decision for the term | Red |
| Renewal due | Active subscription, notice deadline within 90 days, no decision | Amber |
| SOW ending | Active SOW ending within 30 days | Amber |
| SOW past its end date | Active SOW whose end date has passed | Red |
| Close to budget | Active SOW with the warning percentage or more of its budget invoiced | Amber |
| Over budget | Active SOW with more invoiced than its budget | Red |
| NDA or data processing agreement missing | Active vendor that requires one and has none in place | Amber |
| NDA or data processing agreement expired | Active vendor whose only one is past its valid-until date | Red |

Warnings are sorted with what is already wrong first, then the soonest date. The windows and the budget percentage are the admin's settings.

**Import** (A-8): the vendor sheet has the address and VAT or tax number columns, optional, by the vendor form's rules. A vendor row whose name is already in the app, and an agreement row whose vendor, kind and title are already in the app, are left alone. A row that appears twice in the file is a problem, for every copy. An empty owner means the person importing. A cell showing a formula error is a problem, never read as empty. A number finer than a cent is refused, not rounded. A subscription row must say whether it renews automatically. The template's example rows are refused if left in. The preview and the import run the same analysis and always agree.

## SOW delivery and money

**Settings** (admin, one set for the whole team): `gbp_to_eur_rate*` (up to four decimals, default 1.17), `notice_days*` (default 90), `sow_end_days*` (default 30), `budget_warning_pct*` (default 80). The defaults apply until an admin first saves. The Renewals page starts at `notice_days` and can be set to another window for a look further ahead. Changes are recorded in the audit log.

**Milestone**: `sow_id*`, `title*`, `due_date*`, `status*` (open | delivered | cancelled), `delivered_on`, `amount_minor` (fixed-price SOWs only).
- On a fixed-price SOW the amounts of the milestones that are not cancelled may not add up to more than the SOW budget. The budget may not be cut below that sum either.
- A time and materials SOW has milestones without amounts.
- Delivering without a date means today. A delivery date cannot be in the future. Reopening or cancelling clears it.
- **Late** = delivered after `due_date`, or open and past `due_date`. A cancelled milestone is never late.
- Milestones are cancelled, never deleted.

**Change request**: `sow_id*`, `title*`, `description`, `requested_on*`, `status*` (proposed | approved | rejected), `budget_change_minor` (may be negative), `new_end_date`, and once decided `decided_on`, `decided_by`, `budget_before_minor`, `end_date_before`.
- It needs a budget change, a new end date, or both.
- Nothing changes on the SOW until it is approved. Approving applies the budget change and the new end date, and keeps what the SOW held just before.
- **Original budget and end date** of a SOW are what it held before its first approved change.
- An approval is refused when it would take the budget below zero, below what the milestones add up to (fixed price), or the end date before the start date, or when the SOW has ended.
- A decided change cannot be edited or decided again. A proposed one can be edited.
- Once a SOW has an approved change, its budget and end date can no longer be edited directly; they move only through further change requests. Before the first approval they can still be corrected on the SOW itself.

**Rate card line**: `vendor_id*`, `role*`, `day_rate_minor*`, `currency*`, `valid_from*`. One line per role and start date.
- The rate in force for a role on a day is the latest line that has started. A rate is changed by adding a newer line; the old one stays on record.
- Role names are compared ignoring case, and keep the spelling first used.
- The last line of a role cannot be removed while a consultant still holds that role.
- Rate card lines and consultants can be removed; the removal is recorded in the vendor's or the SOW's history.
- A rate may be in a different currency from the SOW (a pound rate on a euro SOW); the SOW shows the rate in its own currency.

**Consultant**: `sow_id*`, `name*`, `role*` (a role on the vendor's rate card), `from_date`, `to_date`. For information; days worked are not tracked. The SOW shows each consultant's day rate in force today.

**Invoice**: `agreement_id*` (sow or subscription), `milestone_id` (a milestone of that SOW), `invoice_number*`, `invoice_date*`, `amount_minor*` (above zero), `description`. The vendor and the currency are taken from the agreement.
- The same `invoice_number` cannot be entered twice for one vendor, ignoring case and extra spaces.
- The invoice date cannot be in the future.
- Once an agreement has invoices, its currency cannot be changed, and an invoice cannot be moved to an agreement in another currency.
- Invoices can be edited and removed; each is recorded in the audit log.

**Budget view** (worked out): invoiced = the sum of the SOW's invoices; remaining = budget minus invoiced; used % is rounded down, so 79.9% never reads as 80%. From `budget_warning_pct` the SOW is close to budget; above 100% it is over budget. The comparison is exact, in cents.

**Money**: whole cents plus currency. Totals are shown per currency, plus a euro total using `gbp_to_eur_rate`, labelled as converted. The pounds are converted once, on their sum, and rounded to the cent. Changing the rate changes converted totals only; no stored amount changes.

**Spend** (worked out): invoiced amounts in a period by invoice date, per vendor and per month, per currency and as a euro total. Without dates the period is the last twelve months up to today, from the first of the month.

## Performance

**Jira board link** (admin): `vendor_id*` (one per vendor), `project_key*` (one vendor per board), `project_name`, `service_desk_id` (not used yet),
`escalation_method*` (status | label), `l1_values`, `l2_values`, `l3_values`, `active*`,
and from the sync: `last_synced_at`, `last_attempt_at`, `last_sync_ok`, `last_sync_message`, `last_sync_updated`.
- The level values are the statuses or labels that mean each support level. At least one value for level 2 or level 3 is required; level 1 values are optional. A value can mean only one level. Values are compared ignoring case.
- The board must exist in Jira when the link is saved. "Test link" checks the board and the values without saving, and points out values the board does not have.
- Saving a new link, or moving a vendor to another board, fetches the tickets straight away. Moving to another board removes the old board's tickets.
- Changing the level values works every held ticket's level out again; nothing is fetched.
- `active` off stops the sync and keeps the tickets and figures. Links are switched off, not deleted.
- Creating and changing a link is recorded in the vendor's history.
- Only a vendor with `scoring_enabled` can be linked. A linked vendor whose scoring is later switched off keeps its board and tickets but shows no figures anywhere until scoring is switched on again.

**Ticket** (copied from Jira): `board_link_id*`, `key*`, `summary`, `description`, `status`, `created_at*`, `resolved_at`,
`first_response_at`, `first_response_breached`, `resolution_breached`, `highest_level*` (1 | 2 | 3), `csat` (1 to 5), `csat_at`,
`statuses_seen`, `labels_seen`, `synced_at`.
- Overwritten on each sync. Removed 24 months after resolution; a ticket resolved longer ago is never taken in. An open ticket is kept however old.
- The first response outcome is the ticket's first response cycle; the resolution outcome is its last one, so a reopened ticket is judged on its final resolution.
- `first_response_breached` and `resolution_breached` are empty while Jira has no outcome: no SLA on the ticket, or still running in time. A running SLA that is already late counts as breached.
- **Highest level** = 3 if the ticket ever carried a level 3 value, else 2 if it ever carried a level 2 value, else 1. A ticket that never carried a listed value was never escalated: level 1. "Ever" includes earlier statuses and labels, which is why they are kept in `statuses_seen` and `labels_seen`.
- Tickets are copies, not business records: a sync writes no audit entries. Its outcome is kept on the board link.

**Sync** (J-2): fetches, per board, the tickets changed since the last successful sync (everything the first time), every hour while the app runs (`JIRA_SYNC_EVERY_MINUTES`), on "Sync now" by any member, and by the command `npm run job -- jira-sync`.
- Everything is fetched before anything is written, and written in one transaction, so a failure leaves the tickets as they were.
- A failure is kept on the link in plain language and shown until the next successful sync. One failing board does not stop the others.
- Every sync also fetches all unresolved tickets, changed or not: a response time that runs out is not a "change" in Jira, and an open ticket that no longer comes back has been deleted, moved to another board or hidden, and is removed here so it cannot age in the backlog for ever.
- If a newer sync of the same board finished while this one was reading Jira, this one writes nothing: its picture is the older one.
- "Tickets updated" counts tickets that changed since the last sync, not the unchanged open ones fetched along with them.
- Running it twice changes nothing.

**Target**: `vendor_id*`, `metric*`, `target_tenths*`. One per vendor and metric. Any member sets them; changes are recorded in the vendor's history. A vendor can have targets before it has a board.
- Whether a figure must be at least or at most its target follows from the metric and is not a choice.
- The targets as they stand today are applied to every month shown; no history of earlier targets is kept.

**Monthly metrics** (worked out from the tickets when shown, not stored): per vendor and month, per metric the figure and whether the target was met. A month runs from midnight to midnight in the team's time zone.

| Metric | Definition | Headline figure | Target |
|---|---|---|---|
| First response | Tickets created in the month that have a first-response outcome: the share answered within the SLA; median first response time alongside. | % answered in time | at least |
| First-line closure rate | Share of tickets resolved in the month that never went above level 1. | % | at least |
| SLA breaches | Count and share of tickets resolved in the month that breached the resolution SLA. | % resolved late | at most |
| Backlog age | Tickets open at the end of the month (now, for the running month): count, and median and oldest age in whole days. | age of the oldest open ticket, in days; zero when the helpdesk is running and none is open; no figure for a month before the board's first ticket | at most |
| Customer satisfaction | Average rating of tickets rated in the month, and number of ratings. | average out of 5 | at least |

- Every figure is held as a whole number of tenths and shown with at most one decimal. The figure as shown is what is compared with the target.
- A month with nothing to measure has no figure and no verdict. A metric without a target has a figure and no verdict.
- Each count behind a figure opens exactly the tickets it counts: one definition serves both.
- A month with a missed target shows "target missed, a service credit may apply". No amount is calculated.

**Performance overview** (J-5): vendors with `scoring_enabled` and a board, for a chosen month (the running month by default), sorted by targets missed, by name or by any metric. Scored vendors in use without a board are named below the list.

**Scorecard criterion** (admin): `name*` (unique, ignoring case), `description`, `weight*` (1 to 100, relative to the other weights), `source*` (measured | manual), `metrics` (the helpdesk metrics a measured criterion is judged from; at least one), `active*`.
- The source is fixed once the criterion exists. Criteria are switched off, never deleted, and at least one stays in use.
- Changes are recorded in the criterion's own history.

Starting set, each with weight 20:

| Criterion | Source |
|---|---|
| Quality of delivery | measured (first-line closure rate, satisfaction; or milestones for project vendors) |
| Timeliness | measured (first response, SLA breaches, backlog; or milestones on time) |
| Responsiveness and communication | manual |
| Value for money | manual (budget kept is shown as a fact) |
| Compliance and security | manual (NDA and DPA status is shown as a fact) |

**Monthly proposal**: `vendor_id*`, `month*` (one per vendor and month), per measured criterion a proposed score 1 to 5 with a written reason and the metric values used, plus ticket themes. Produced by AI. Never final by itself.
- Made only for a month that is over, for a scored vendor with a board, when something was measured. The app writes last month's by itself (it looks every `AI_PROPOSALS_EVERY_MINUTES`); any member can ask for an earlier month's.
- The metric values are the app's own, handed to the model and stored with the proposal. The model writes the score and the reason.
- The model is given the tickets created in the month (at most 250) and names the tickets of each theme. The app keeps only tickets it really handed over, counts them itself, drops a theme with fewer than two, and keeps at most five themes with three example tickets each.
- A person accepts it, changes its scores (the AI's own score stays visible), or rejects it; the decision can be changed later. Each decision is in the vendor's history with who and when.
- It can be asked for again while nobody has accepted it; the answer it replaces is closed as rejected by `system`, so nothing is left waiting for a review that will never come. Once accepted or changed by a person it is kept.
- A score that flatly contradicts the app's figures (4 or 5 where every judged target was missed, 1 or 2 where every one was met) counts as an unusable answer. Ticket text is handed to the model as material to read, never as instructions.
- If the model cannot be reached or its answer cannot be used (asked twice), nothing is stored and the page says so.

**Scorecard**: `vendor_id*`, `period_start*`, `period_end*` (a quarter), `reviewer_user_id*`, `status*` (draft | final),
per criterion a `score` 1 to 5, a `vendor_comment` and an `internal_note`, plus `summary`.
- One per vendor and quarter. The quarter must have started. The person who starts it is the reviewer.
- For a measured criterion the suggestion is the average of the quarter's monthly proposals that were not rejected, rounded to a whole score (a half rounds up). It is only a suggestion: the line has no score until the reviewer accepts it or chooses one. The line remembers what was suggested and whether it was taken as it was.
- A draft follows the criteria in use today. Each change (a score, a comment, a note) is saved by itself, so two saved at once do not undo each other.
- Supporting facts, worked out in code: SOWs with a budget that ran in the quarter and whether what was invoiced by the end of the quarter is within the budget; milestones due in the quarter on SOWs that are active or ended (on time, late, overdue, not yet due; cancelled ones left out); NDA and DPA status on the day shown.
- Finalising needs the quarter to be over and a score on every active criterion, and freezes what the scorecard shows: its criteria with their names and weights, the suggestions, the facts and the helpdesk figures. Later changes to criteria, targets or agreements do not alter it (P-7).
- A final scorecard is read-only; an admin can reopen it, after which it is a draft that follows today's criteria and figures again. A draft can be removed; a final one cannot.
- Overall = weighted average of the scored lines, one decimal.
- Only for vendors with `scoring_enabled`. When scoring is switched off, the vendor's scorecards and proposals are kept but not shown, and come back when it is switched on again.
- The database refuses a final scorecard without its frozen copy.
- The vendor PDF (final only) holds the reviewer's name (left out when only an email address is known), the overall score, each criterion's score, weight and comment for the vendor, the summary, and the quarter's helpdesk figures. It leaves out internal notes, the supporting facts and anything about the AI.

## Risk flags, dashboard, report and briefings

**Risk flag** (worked out, not stored), for R-1. Shown with the warnings, always amber, each with the facts that set it off:

| Flag | When | Facts stated |
|---|---|---|
| Heading over budget | Active SOW (fixed price or time and materials) with a budget, a start and an end date, running at least 30 days and not yet ended, not already over budget, where what has been invoiced so far, carried on at the same pace per day since the start date, would come to more than the budget by the end date | Invoiced, budget, days gone of the total, the day the budget would run out, the end date, the amount that would be invoiced by then |
| Ending with open milestones | Active SOW whose end date is today or within `sow_end_days`, with at least one milestone still open | End date, days left, the open milestones with their due dates (the first three by name) |
| Helpdesk figure getting worse | Scored vendor with a board where, over the last four whole months, a metric's figure is worse each month than the month before (three steps down). A month with nothing measured breaks the run. The running month is left out | The metric, the four figures, the target |

- "Worse" follows the metric: lower for first response, first-line closure and satisfaction; higher for SLA breaches and backlog age.
- Days are counted from the start date up to, not including, the end date. Exactly the budget by the end date is not an overrun.
- Helpdesk flags are for scored vendors in use (active or on hold); an offboarded vendor's board raises none.
- A SOW already over budget has the red warning, not this flag.

**Dashboard** (D-1, worked out): warnings and risk flags counted per kind; active SOWs with a budget, the most used first; spend per month for the last twelve months; per scored vendor the latest final scorecard and how it compares with the final one before (up, down, unchanged, or first scorecard); the scorecards due; open RFPs (none until RFPs exist).
- **Scorecards due** are for the last quarter that is over: every vendor with `scoring_enabled` and status active or on hold that has no final scorecard for that quarter. A draft counts as due and is linked.

**Management report** (D-2): `month*` (one per month), `summary`, `suggestion_id`. Only the summary is stored; the figures are worked out when the report is opened or downloaded.
- Figures are **as at** the last day of the month, or today while the month is running.
- Spend: invoices dated in the month. Budgets: SOWs with a budget that ran in the month (active, or ended on or after its first day), with what was invoiced up to the as-at day against the budget as it stands today.
- Agreements ending: agreements that are active today whose end date, as it stands today, is within 90 days after the as-at day. One that has since been renewed or ended is not listed for an earlier month.
- Budgets likewise use each SOW's status and budget as they stand today.
- Scores: each scored vendor's latest final scorecard for a quarter that had ended by the as-at day, with its trend.
- Missed targets: the month's helpdesk figures that missed today's target, for scored vendors in use.
- For the running month and the 23 before it.
- With the summary a fingerprint of the month's figures is kept (`summary_figures`). When the figures are no longer the ones the summary was saved against (an invoice keyed in later, the running month moving on), the page says so and the PDF prints a line under the summary; saving the summary again, changed or not, confirms it for the figures as they are now.
- No record exists for a month until someone saves a summary or asks the AI; that first write is the record's "create" in the audit log.
- The PDF is at most two pages: when there is more than fits, the tables are shortened and each says how many rows it leaves out.
- The AI's summary is a suggestion. The report's `summary` is what a person saved (their own words, or the AI's text taken over and possibly changed) and is the only summary the PDF prints. At most 1,500 characters.

**Briefing** (B-1): `vendor_id*`, `as_at*`, `facts*`, `summary`, `talking_points` (one per line), `suggestion_id`.
- `facts` is everything the briefing shows, gathered when it is prepared and never changed afterwards: the vendor and its paperwork; agreements that have not ended; dates (notice deadlines without a decision, also when passed; end and renewal dates in the next 180 days; open milestones due within 180 days, also when overdue; a SOW past its end date); active SOWs' budgets; what was invoiced in the last twelve months; the last three whole months of helpdesk figures with, per metric, whether the latest month is better or worse than the one before; the targets missed in those months; the latest final scorecard and its trend; open milestones; change requests still proposed; and the vendor's warnings and risk flags.
- A vendor can have any number of briefings; a new one is prepared for a later day.
- The AI's summary and talking points are a suggestion. The briefing's own `summary` and `talking_points` are what a person saved, and are the only text the PDF prints.
- The AI can be asked again until someone has taken its text over. When it cannot answer, the briefing is made without its text.
- A briefing can be removed. Preparing, saving, reviewing and removing are recorded in the briefing's own history.

**AI text on a report or briefing**: accepted when taken over unchanged, edited when the saved text differs from the AI's, rejected when dismissed; rejecting leaves a person's own text alone. The AI is given the figures already worked out and written as the app shows them, and an answer that quotes any number that was not among them is refused as unusable (single digits aside; a number inside a name someone typed, such as a SOW title, counts only when the whole name is quoted). Accepting or rejecting names the text the person was looking at: if the AI has written another since, nothing changes and they are asked to read the new one.

## RFP

**RFP**: `title*`, `need*`, `budget_minor`, `currency`, `sponsor`, `demand_approved_on`, `target_decision_date`, `owner_user_id*`,
`stage*` (drafting | in_review | approved | issued | evaluating | decided | cancelled), `written_weight*`, `demo_weight*` (sum 100; 70 and 30 to start with), `cancel_reason`.
- Stages: a member moves an RFP between drafting, in review and approved. The first issue to a candidate makes it issued, the first answer or score makes it evaluating, the decision makes it decided. Any running RFP can be cancelled with a reason. A decided or cancelled RFP does not change any more.
- It can go to review once it has a section, a question, criteria for every part that counts and weights that add up.
- The budget and the sponsor stay inside the team: they are in the review copy and the decision record, never in what goes to a candidate or to the AI.
- Every change to an RFP and its parts is recorded in the RFP's own history.

**RFP criterion**: `rfp_id*`, `name*` (unique within its part), `weight*` (1 to 100; the weights within a part add up to 100), `part*` (written | demo).
**RFP section**: `rfp_id*`, `position*`, `heading*`, `body` (formatted text since M11: paragraphs, sub-headings, bullet and numbered lists, bold, italic, simple tables; text from before is plain paragraphs), `body_format*` (markdown | plain), `rewrite_suggestion_id`, `rewrite_for`.
- Formatted text is stored as a small, strict subset of Markdown (`shared/richtext.ts`): one level of lists, two levels of sub-heading, tables with a header row of at most 60 rows and 8 columns. It is saved in one tidy form, so the same text never counts as a change. Text typed before M11 is marked `plain` and is read as one paragraph per line, character for character, so nothing in it is taken for formatting; it is saved as formatted text from the first save on.
- A section keeps its id when the document is saved again, so a reviewer's remark and an AI rewrite stay with it; a section left out of a save is removed.
**RFP question**: `rfp_id*`, `number*` (its place in the list), `text*`, `criterion_id*` (a written criterion).
- Sections, criteria and questions are saved together as one document. They and the two part weights can be changed while drafting or in review. An approved RFP is fixed as approved and has to be taken back to drafting to change; once it is `issued` it is locked for good.
- The template gives six sections and six criteria (four written, two demo). The AI's draft is a suggestion; the document is what a person saved. A draft taken over counts as accepted while the document still reads as drafted and as edited once it does not.

**Review sign-off**: `rfp_id*`, `reviewer_name*`, `reviewer_role`, `outcome*` (approved | changes_requested), `on_date*` (not in the future), `comment` (required for requested changes), `resolved_on`, `superseded`.
- A requested change is open until a member marks it as dealt with. Approved needs at least one approval that still counts and no open request. Sign-offs are recorded in review and stand once the RFP is approved.
- When the document or the part weights change, every approval given before is marked as superseded: it stays in the trail as "approved an earlier version" and no longer counts.

**Review round** (Q-13): `rfp_id*`, `version*` (1, 2, ... per RFP), `made_at*`, `made_by*`, `content*` (the demand, sections, criteria and questions exactly as in the review copy), `fingerprint*`, the review copy itself in file storage. Made when a review copy is downloaded; a download with no change since the last round reuses that round and gives its file again. A change is any change to the words, the weights or the demand, or a new Word template in force: the copy then looks different, so it is a new version. A new round is not made once the RFP is decided or cancelled; earlier rounds stay downloadable.
- The review copy carries two hidden custom document properties, the RFP and the version, by which a returned copy is recognised.

**Returned review file**: `round_id*`, `file_name*`, `size_bytes*`, the Word file in file storage, `sha256*`, `uploaded_by*`, `uploaded_at*`. Kept apart from an agreement's or a candidate's documents, so Ask does not search it. Must be a .docx review copy of this RFP; one that carries another version's mark goes into that version's round, and the answer says so. The same file twice in one round is refused. A file can be removed, with its remarks, while none of them has been dealt with or set aside. Uploaded while drafting or in review.

**Reviewer remark** (Q-13): `file_id*`, `rfp_id*`, `position*` (reading order in the file), `kind*` (comment | suggested_edit), `author*` (the name in Word), `section_id` (empty until placed, and again if its section is removed), `found_under*` (the Heading 1 it stands under in the file, or "Cover page"), `anchor_text` (the words commented on), `text` (the comment), `removed_text`, `added_text`, `before_text`, `after_text` (a suggested edit with a few words on either side, as in the file), `status*` (open | dealt_with | set_aside), `resolution` (taken_over | ai_rewrite | by_hand), `resolved_by`, `resolved_at`.
- Read from the file: comments (a reply stands where the comment it answers stands, as a remark of its own), and tracked changes, where deleted and inserted words next to each other by one reviewer make one suggested edit. The text the remarks are placed against is what the review copy said: deleted words in, inserted words out.
- Placed by the section heading it stands under and, when two sections have the same heading, by their order, against the round's content; and only if that section still exists. Remarks under the demand, the criteria or the questions are not placed. A member places one in a section, deals with it or sets it aside.
- A suggested edit is taken over where its removed words, with the words around them, stand in the section once as it is now; failing that, where the removed words alone stand once. Otherwise it is done by hand, and the page says so beforehand. Taking one over changes the section as a save would: an approval given before no longer counts.
- An open remark of any round blocks moving to approved. Remarks are worked on while drafting or in review. Every action on a remark, and every upload, is in the RFP's history.

**Section rewrite** (Q-12): an AI suggestion of kind `rfp_section_rewrite` with the section as subject, the instruction and any remarks it answers as input, and the new section text as output. The section points to its latest one (`rewrite_suggestion_id`) and keeps `rewrite_for` (the remarks, the instruction, and a fingerprint of the text it was made from). Asking again sets an unread earlier one aside. Accepted when used as it is, edited when changed first, rejected otherwise; using it deals with the open remarks it was asked for. A rewrite of a text that changed since cannot be used. Asked and used only while drafting or in review, for a section with text, and only for open remarks placed in that section. The figures rule of the other prompts applies, and the budget and sponsor are not passed.

**Word template** (Q-14, admin, one in force): a Word file (.dotx or .docx, at most 10 MB, no macros) kept in file storage, `file_name*`, `uploaded_by*`, `uploaded_at*`, `in_force*`, `found*` (what the app recognised: cover page, where the [Title], [Date] and [Version] marks are, header, footer, pictures, the body font, and the heading, list and table styles by their built-in names). Every upload is kept; at most one is in force. Uploading, and going back to the plain layout, are recorded in the settings history. Without one in force, the app's own plain layout is used, which is made the same way from a built-in template. No template file is in the repository: the invented example ("Larkspur & Vale") is drawn by the app itself.
- [Title] becomes the RFP's title, [Date] the day the file is made (22 Nov 2026), [Version] "Version 2" in a review copy. A candidate's copy has no version: [Version] is left empty there. The marks are found in any capitals, also when Word has split them over several pieces of text, on the cover page, in the header and in the footer.
- The template's body is its cover page and is kept as it is; the RFP's text starts on the next page, in the template's Heading 1 to 3, List Bullet and List Number, and Table Grid styles where it has them, and in plain formatting where it does not. Each numbered list starts at 1.

**Candidate**: `rfp_id*`, `vendor_id*` (once per RFP, not an offboarded vendor), `list*` (longlist | shortlist | dropped), `reason*`, `issued_on`, `nda_warning_acknowledged_by`, `response_received_on`, `unmatched` (rows of an uploaded answer sheet that fitted no question).
- A new vendor is created as a prospect owned by the member who adds it.
- Only a shortlisted candidate of an approved RFP is issued. Without an NDA in place (or not required) the member must acknowledge the warning; who did is kept.
- An issued candidate cannot go back to the longlist; it is dropped. A candidate that was issued or has answers, documents or scores is never removed.
- Answers and scores are about candidates that are shortlisted and issued.

**Answer**: `candidate_id*`, `question_id*`, `text*`. Filled from the uploaded response or typed in.
- An uploaded row belongs to the question whose number it carries, provided the question written in the row is that question; when number and wording disagree, or there is no number, the wording decides. A row that fits none, or a second answer to one question, is kept as unmatched until a member places or sets it aside. Uploading again replaces the answers it matches; a replaced answer is in the history with both texts.
- Placing or setting aside an unmatched row names the row by its place and its text; if the list has changed since, nothing happens and the person is told.
- A response document (the uploaded sheet, anything else the candidate sent) is a **Document** attached to the candidate.

**AI comparison** (one AI suggestion per RFP, made per written criterion): per question a summary per candidate and the differences; per candidate and written criterion a proposed score with a reason and a passage of at least 20 characters (or a whole shorter answer) that occurs word for word in that candidate's answers. It may quote no number that is not in the answers. It is asked again by hand; the RFP keeps a fingerprint of the answers it read, so the page can say when one has changed.

**Evaluation score**: `candidate_id*`, `criterion_id*`, `evaluator_user_id*`, `score*` (1 to 5), `comment`, `suggested_score` (what the AI proposed when the score was given).
- Candidate score per criterion = average across evaluators. Part score = average of its criteria by weight, once every criterion of the part has a score. Overall = written part and demo part combined by their weights; a part that counts for 0 is left out.
- Averages are kept exact and rounded once to two decimals, halves up. Candidates are ranked on the rounded overall score; equal scores share a place.
- The comparison counts as accepted while every score given with it equals its proposal, and as edited once one differs.

**Decision** (kept on the RFP): `winner_candidate_id*` (a candidate the RFP was issued to), `decided_on*` (not in the future, not before the winner was issued the RFP), `rationale*`. Sets the winner's vendor to `active`. No agreement is created.

## AI and audit

**AI suggestion** (every AI output): `kind*`, `subject_type*`, `subject_id*`, `model*`, `prompt_version*`, `input_summary`, `output*`,
`status*` (proposed | accepted | edited | rejected), `reviewed_by`, `reviewed_at`.
- `output` is the model's answer exactly as given and is never changed; a person's edits are stored with the record the suggestion belongs to.
- "Edited" means a person's value now differs from the AI's.
- An answer to a question (C-1) is kept as a suggestion with kind `ask_answer` (or `ask_plan` when nothing was looked up), the person who asked as its subject, the question as `input_summary`, and the answer with the look-ups it rested on as `output`. It stays `proposed`: an answer is read, not accepted, and never becomes part of a record. There is no other record of a conversation; the conversation on screen lives in the browser tab.

## Contract reading

A **reading** (E-1) is an AI suggestion about one document attached to an agreement (kind `contract_fields`, the document as its subject). It holds, for each of kind, title, signed on, start date, end or renewal date, notice period in days, amount and currency, either nothing or a value with the passage it was read from.
- The model's answer is kept as given, but only what the document bears out is shown or can be used. A value is kept when its passage stands in the document word for word, beginning and ending at whole words and whole numbers, and itself states the value: a date as a whole date ("4 January 2027", "the 9th of March 2027", "2027-03-09", or "09/03/2027" read day first); an amount as a number with its currency right next to it (€, £, EUR, GBP, euros, pounds); a notice period as a number of days in a sentence about notice, cancelling or terminating (months and working days are not converted); a title that occurs in its own passage; a kind by the words the document uses for it ("statement of work", "subscription", "master services agreement"). A value that fails this is left out and named on the page as left out; the other values stand.
- An amount is its number and its currency together. The currency of an amount is the one written next to it in its passage, whatever else the model answered; an amount in any other currency than euros or pounds is left out. The same number in another currency differs. Amount and currency are taken over together or not at all, and a currency read without an amount cannot replace the currency of an amount the agreement already holds.
- Nothing is worked out from other values.
- The first 30,000 characters of the document are read; the page says when a document is longer.
- Where a value goes depends on the agreement's kind: the amount is a SOW's budget or a subscription's annual value; the notice period exists for subscriptions only; an MSA has no end date and an NDA or DPA no start date. The kind itself is compared and never changed.
- Each read value is one of: the same as the agreement holds, different (can be taken over), or not applying to this kind of agreement.
- Using values: a member chooses among the different ones. They are saved through the agreement's own rules in one transaction with the record of the review; if a rule refuses one, nothing is saved.
- The reading is `accepted` when every different value was taken, `edited` when only some were, `rejected` when dismissed. A reading that has been used or rejected cannot be used again; the AI can be asked to read again at any time, which closes a reading nobody had looked at; so does removing the document. A reading and its review take turns per document, so the same reading is never used twice.
- Asking, using and rejecting are each a line in the agreement's history. Only documents attached to an agreement can be read, not what an RFP candidate sent.

## Ask a question

Nothing new is stored beyond the suggestion row above. A question is answered from **look-ups**: a fixed list of read-only queries, each the same function a list page or a record's page uses.

| Look-up | What it returns | The page with the same figures |
|---|---|---|
| vendors | The vendor list, filtered by name, type, status, owner | Vendors |
| vendor | One vendor with contacts, paperwork, its agreements and RFPs | The vendor's panel |
| agreements | The agreement list, filtered by vendor, kind, status, owner, words, and the period the end date falls in | Agreements |
| renewals | Subscriptions without a renewal decision whose notice deadline has passed or is near | Renewals |
| sow | One SOW with budget, milestones, change requests, consultants | The SOW's page |
| sow_budgets | Active SOWs with budget against invoiced | Dashboard |
| invoices | The invoice list with totals per currency, by vendor, period, words | Invoices |
| spend | Spend per vendor and month for a period | Money |
| helpdesk | Every board's figures for a month | Performance |
| vendor_helpdesk | One vendor's last six months of figures | The vendor's performance page |
| scorecards | Scorecards by vendor and status | Scorecards |
| warnings | Warnings and risk flags, by vendor or kind | Warnings |
| rfps | The RFP list by stage and title | RFPs |
| rfp | One RFP with candidates, scores so far and the decision | The RFP's page |
| documents | Up to five passages of uploaded documents that share the most words with the question | The agreement or RFP the document is attached to |

- The model first chooses up to four look-ups and their filters; it sees no data at that point, only the names of vendors, colleagues and RFPs so it can recognise them, and the first and last day of the periods a question can name ("this quarter"), worked out by the app.
- The app runs the look-ups. Every count and total is worked out in code. A list gives its first 40 rows to the model and the page; its count is always of the whole list.
- A vendor or colleague the app cannot match to exactly one name is never dropped from the filter: the look-up returns nothing but a note saying so. A name written loosely that fits exactly one ("bluefinch") is used, and the result says whom it was taken to mean.
- A look-up offers a link to a list only when that list shows the same thing: the Renewals look-up uses the windows that page offers (30, 60, 90, 180 days or the team's own), and warnings for one vendor or risk flags alone have no link because the Warnings page cannot show just those.
- The model then writes the answer from the results. An answer is refused (and asked for once more, then reported as a failure) when it quotes a figure that is in neither the results nor the question (single digits aside; a date counts as one thing and an amount with its currency; digits inside a name or text someone typed, or inside the words the model itself chose to search for, count only when the whole of it is quoted), names a source that was not looked up, or names no source although records were found.
- When no look-up fits, the answer is a fixed sentence written by the app: that it does not hold this, or, for a request to change something, that Ask can only look things up.
- A passage is at most a few sentences (about 420 characters), cut at clause headings where there are any, and shown word for word with its document, its page or sheet, and where the document is attached. Passages are found by shared words, not by meaning.
- The last three questions of a conversation go along with a new one so a follow-up can be understood; earlier answers do not.

**Audit log entry**: `at*`, `user_email*`, `action*`, `entity_type*`, `entity_id*`, `summary` (a readable label for the record, such as a vendor name), `changes`. Written in the same transaction as the change. Never edited or removed: the database itself refuses any update, delete or truncate of the audit log. Changes the app makes by itself are recorded with `system` as the user.
