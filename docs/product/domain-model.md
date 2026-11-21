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

**Jira board link**: `vendor_id*` (one per vendor), `project_key*`, `service_desk_id`,
`escalation_method*` (status | label), `l1_values*`, `l2_values`, `l3_values`, `active*`, `last_synced_at`, `last_sync_result`.

**Ticket** (copied from Jira): `board_link_id*`, `key*`, `summary`, `description`, `status`, `created_at*`, `resolved_at`,
`first_response_at`, `first_response_breached`, `resolution_breached`, `highest_level` (1 | 2 | 3), `csat` (1 to 5).
Overwritten on each sync. Removed 24 months after resolution.

**Target**: `vendor_id*`, `metric*`, `target_value*`, `direction*` (at_least | at_most). One per vendor and metric.

**Monthly metrics**: `vendor_id*`, `month*`, and per metric the value and whether the target was met.

| Metric | Definition |
|---|---|
| First response | Share of tickets created in the month whose first response met its SLA; median first response time alongside. |
| First-line closure rate | Share of tickets resolved in the month that never went above level 1. |
| SLA breaches | Count and share of tickets resolved in the month that breached the resolution SLA. |
| Backlog age | Open tickets at month end: count, and median and oldest age in days. |
| Customer satisfaction | Average rating of tickets rated in the month, and number of ratings. |

A month with a missed target shows "target missed, a service credit may apply". No amount is calculated.

**Scorecard criterion** (admin): `name*`, `description`, `weight*`, `source*` (measured | manual), `active*`. Starting set:

| Criterion | Source |
|---|---|
| Quality of delivery | measured (first-line closure rate, satisfaction; or milestones for project vendors) |
| Timeliness | measured (first response, SLA breaches, backlog; or milestones on time) |
| Responsiveness and communication | manual |
| Value for money | manual (budget kept is shown as a fact) |
| Compliance and security | manual (NDA and DPA status is shown as a fact) |

**Monthly proposal**: `vendor_id*`, `month*`, per measured criterion a proposed score 1 to 5 with a written reason and the metric values used, plus a ticket theme summary. Produced by AI. Never final by itself.

**Scorecard**: `vendor_id*`, `period_start*`, `period_end*` (a quarter), `reviewer_user_id*`, `status*` (draft | final),
per criterion a `score` 1 to 5, a `vendor_comment` and an `internal_note`, plus `summary`.
- Starts from the average of the quarter's monthly proposals; the reviewer may change every score.
- Finalising needs a score on every active criterion. A final scorecard is read-only; an admin can reopen it.
- Overall = weighted average, one decimal.
- Only for vendors with `scoring_enabled`.

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

**Audit log entry**: `at*`, `user_email*`, `action*`, `entity_type*`, `entity_id*`, `summary` (a readable label for the record, such as a vendor name), `changes`. Written in the same transaction as the change. Never edited or removed: the database itself refuses any update, delete or truncate of the audit log. Changes the app makes by itself are recorded with `system` as the user.
