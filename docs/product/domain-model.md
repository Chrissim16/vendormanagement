# Domain model

Fields marked `*` are required. Every table also has `id`, `created_at`, `created_by`,
`updated_at`, `updated_by`. Records are ended or archived, not deleted, unless stated.

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
- Owners (vendor, agreement, RFP) must be active users. A user who owns any record cannot be deactivated until the records are handed over. A new agreement defaults to its vendor's owner.
- RFP candidates are vendors with status `prospect`.

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
| nda, dpa | `signed_on*`, `end_date` (valid until, optional) | Counts as in place when active and not past `end_date`. |

- `start_date*` and `signed_on*` are required once status is `active`.
- `end_date` is on or after `start_date`.
- `ended` needs an end reason: completed, expired, terminated or replaced.

Derived, not stored:
- **Notice deadline** (subscription) = `end_date` minus `notice_period_days`.
- **Renewal state** (subscription): overdue, due soon (within `notice_days`), ok.
- **SOW budget** = original `budget_minor` plus approved change requests. **Invoiced** = sum of its invoices. **Used %** = invoiced / budget.
- **Compliance gap** (vendor): active vendor with `nda_required` and no NDA in place, or `dpa_required` and no DPA in place.

**Renewal decision**: `agreement_id*` (subscription), `decision*` (renew | renegotiate | terminate), `decided_on*`, `decided_by*`, `notes`. Clears the warning for that term. `renew` can roll the dates forward by the renewal term.

**Document**: attached to an agreement or an RFP. `title*`, `file_name*`, `content_type*`, `size_bytes*`, `storage_key*`, `kind` (signed | draft | response | other), `extracted_text`. PDF, Word and Excel only, 25 MB at most.

## Import

Not a stored record, a rule set for loading existing data from an Excel template (A-8, M-8).
- Matching, so a second upload creates nothing new: vendor by name (ignoring case and spaces); contact by vendor and email, else vendor and name; agreement by vendor, kind and title; rate card line by vendor, role and valid-from; invoice by vendor and invoice number.
- An existing match is skipped and reported. An import never changes an existing record.
- Every row is checked by the same rules as the matching form (required fields, dates, status, currency match, duplicate invoice number).
- Order in one file: vendors, then contacts and agreements, then rate cards and invoices.
- The audit entry for each imported record says it was imported.

## SOW delivery and money

**Milestone**: `sow_id*`, `title*`, `due_date*`, `status*` (open | delivered | cancelled), `delivered_on`, `amount_minor` (fixed-price SOWs).
- On a fixed-price SOW the milestone amounts may not add up to more than the SOW budget.
- **Late** = delivered after `due_date`, or open and past `due_date`.

**Change request**: `sow_id*`, `title*`, `description`, `requested_on*`, `status*` (proposed | approved | rejected), `budget_change_minor`, `new_end_date`.
- Approving one applies its budget change and new end date to the SOW and keeps the previous values in the history.

**Consultant**: `sow_id*`, `name*`, `role*` (a role on the vendor's rate card), `from_date`, `to_date`. For information; days worked are not tracked.

**Invoice**: `agreement_id*` (sow or subscription), `milestone_id`, `invoice_number*`, `invoice_date*`, `amount_minor*`, `currency*`, `description`.
- The same `invoice_number` cannot be entered twice for one vendor.
- Currency must match the agreement's currency.

**Money**: whole cents plus currency. Totals are shown per currency, plus a EUR total using `gbp_to_eur_rate`, labelled as converted.

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

**Audit log entry**: `at*`, `user_email*`, `action*`, `entity_type*`, `entity_id*`, `summary` (a readable label for the record, such as a vendor name), `changes`. Written in the same transaction as the change. Never edited or removed. Changes the app makes by itself are recorded with `system` as the user.
