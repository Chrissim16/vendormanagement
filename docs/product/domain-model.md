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
`status*` (prospect | active | on_hold | offboarded), `owner_user_id*`, `website`, `country`, `description`, `notes`,
`scoring_enabled*` (default yes), `nda_required*` (default yes), `dpa_required*` (default yes).
- A vendor with an active agreement cannot be offboarded.
- An offboarded vendor cannot receive new agreements, and none of its agreements can be made active. Every other status can, so a prospect can sign an NDA.
- Names are stored with extra spaces removed and compared ignoring case.
- The owner must be a person who has access to the app.
- RFP candidates are vendors with status `prospect`.
- Changes to a vendor's contacts are recorded in the vendor's history.

**Contact**: `vendor_id*`, `name*`, `job_title`, `email`, `phone`, `is_primary*`. At most one primary per vendor.

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

**Document**: attached to an agreement (and from M6 to an RFP). `title*`, `file_name*`, `content_type*`, `size_bytes*`, `storage_key*`, `extracted_text`. PDF, Word and Excel only, 25 MB at most, judged by the file's content as well as its name. The stored file's name is generated, so nothing a person typed becomes part of a file path. Attaching and removing are recorded in the agreement's history.

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

**Import** (A-8): a vendor row whose name is already in the app, and an agreement row whose vendor, kind and title are already in the app, are left alone. A row that appears twice in the file is a problem, for every copy. An empty owner means the person importing. A cell showing a formula error is a problem, never read as empty. A number finer than a cent is refused, not rounded. A subscription row must say whether it renews automatically. The template's example rows are refused if left in. The preview and the import run the same analysis and always agree.

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
`stage*` (drafting | in_review | approved | issued | evaluating | decided | cancelled), `written_weight*`, `demo_weight*` (sum 100).

**RFP criterion**: `rfp_id*`, `name*`, `weight*`, `part*` (written | demo).
**RFP section**: `rfp_id*`, `position*`, `heading*`, `body`.
**RFP question**: `rfp_id*`, `number*`, `text*`, `criterion_id*` (a written criterion).
**Review sign-off**: `rfp_id*`, `reviewer_name*`, `reviewer_role`, `outcome*` (approved | changes_requested), `on_date*`, `comment`.

**Candidate**: `rfp_id*`, `vendor_id*`, `list*` (longlist | shortlist | dropped), `reason*`, `issued_on`, `response_received_on`.
**Answer**: `candidate_id*`, `question_id*`, `text`. Filled from the uploaded response.
**AI comparison**: per question a summary per candidate and the differences; per candidate and criterion a proposed score with reason.
**Evaluation score**: `candidate_id*`, `criterion_id*`, `evaluator_user_id*`, `score*` (1 to 5), `comment`.

- Candidate score per criterion = average across evaluators. Part score = weighted average of its criteria. Overall = written part and demo part combined by their weights.
- Questions and criteria are locked once the stage is `issued`.

**Decision**: `rfp_id*`, `winner_candidate_id*`, `decided_on*`, `rationale*`. Sets the winner's vendor to `active`. No agreement is created.

## AI and audit

**AI suggestion** (every AI output): `kind*`, `subject_type*`, `subject_id*`, `model*`, `prompt_version*`, `input_summary`, `output*`,
`status*` (proposed | accepted | edited | rejected), `reviewed_by`, `reviewed_at`.
- `output` is the model's answer exactly as given and is never changed; a person's edits are stored with the record the suggestion belongs to.
- "Edited" means a person's value now differs from the AI's.

**Audit log entry**: `at*`, `user_email*`, `action*`, `entity_type*`, `entity_id*`, `summary` (a readable label for the record, such as a vendor name), `changes`. Written in the same transaction as the change. Never edited or removed: the database itself refuses any update, delete or truncate of the audit log. Changes the app makes by itself are recorded with `system` as the user.
