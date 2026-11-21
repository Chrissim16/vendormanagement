# Domain model

Fields marked `*` are required. Every table also has `id`, `created_at`, `created_by`,
`updated_at`, `updated_by`. Nothing is hard-deleted except where stated; records are
archived or set to an end status so history stays intact.

## User
`email*` (unique, lower case, from Entra ID), `display_name`, `role*` (admin | editor | viewer), `active*`.

- A user record is created as `viewer` the first time someone signs in.
- The email in the `BOOTSTRAP_ADMIN_EMAIL` setting becomes `admin` on first sign-in.
- There must always be at least one active admin.

## Category
`name*` (unique), `active*`. Admin-managed list, for example Software, Cloud, Consultancy, Hardware, Telecom, Facilities.

## Vendor
`name*` (unique, case-insensitive), `legal_name`, `category_id*`, `status*`
(prospect | active | on_hold | offboarded), `criticality*` (low | medium | high | critical),
`owner_user_id*`, `website`, `country` (ISO code), `vat_number`, `description`, `notes`.

- Only an `active` vendor can receive new contracts.
- A vendor with a contract in status `active` cannot be set to `offboarded`.

## Contact
`vendor_id*`, `name*`, `job_title`, `email`, `phone`, `is_primary*`. At most one primary contact per vendor.

## Document link
`vendor_id*` or `contract_id*` (exactly one), `title*`, `url*` (https only), `kind` (contract | sla | certificate | other).

## Contract
`vendor_id*`, `title*`, `reference` (our contract number), `type*` (licence | subscription | services | maintenance | framework | other),
`status*` (draft | active | expired | terminated), `start_date*`, `end_date` (empty means open-ended),
`notice_period_days*` (default 90), `auto_renews*`, `renewal_term_months`,
`annual_value_minor`, `total_value_minor`, `currency*`, `owner_user_id*`, `notes`.

Derived, not stored:
- **Notice deadline** = `end_date` minus `notice_period_days`. The last day to cancel or renegotiate.
- **Renewal state**: `overdue` (notice deadline has passed, contract still active, no decision recorded), `due_soon` (deadline within 90 days), `ok`, or `none` (open-ended).

Rules:
- `end_date` is on or after `start_date`.
- An active contract whose `end_date` has passed and which does not auto-renew is shown as expired.

## Renewal decision
`contract_id*`, `decision*` (renew | renegotiate | terminate), `decided_on*`, `decided_by*`, `notes`.
Recording a decision clears the contract from the action list for that term. A `renew`
decision can create the follow-on term by moving `start_date` and `end_date` forward.

## Spend entry
`vendor_id*`, `contract_id`, `period_date*` (invoice date, or first day of the month for monthly totals),
`amount_minor*`, `currency*`, `description`, `invoice_reference`, `source*` (manual | upload), `upload_batch_id`.

## Upload batch
`file_name*`, `uploaded_by*`, `uploaded_at*`, `row_count*`, `status*` (imported | reverted).
Reverting a batch removes its spend entries. This is the one place rows are really deleted.

## Scorecard
`vendor_id*`, `period_start*`, `period_end*`, `reviewer_user_id*`, `status*` (draft | final), `summary`.
One score per criterion, each `1` to `5` with an optional comment. Overall score is the weighted average, one decimal.

## Scorecard criterion
`name*`, `description`, `weight*`, `active*`. Admin-managed. Starting set, equal weights:
Quality of delivery, Timeliness, Responsiveness and communication, Value for money, Compliance and security.

- A final scorecard cannot be edited. An admin can reopen it.
- Changing criteria does not change scorecards that are already final.

## Audit log entry
`at*`, `user_email*`, `action*` (create | update | delete | import | revert), `entity_type*`, `entity_id*`, `changes` (before and after values of changed fields).
Written in the same transaction as the change. Never edited or deleted.

## Money and currency
Amounts are whole numbers of the smallest unit (cents) with an ISO currency code. Totals
across vendors are shown per currency. Version 1 does no currency conversion.
