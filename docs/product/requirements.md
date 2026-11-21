# Requirements

Each requirement has an ID and acceptance criteria. A requirement is met when every
criterion can be demonstrated in the running app. Field names and business rules are in
`domain-model.md`. Milestones are in `../plan/implementation-plan.md`.

Roles: **admin** can do everything; **editor** can create and change business records;
**viewer** can only read.

## Foundation (M0)

**F-1 Sign-in.** A colleague opening the app is recognised without a separate login.
- The header shows the signed-in person's name or email and their role.
- A first-time visitor is added as a viewer automatically.
- The email configured as bootstrap admin becomes an admin on first visit.

**F-2 Roles.** What a person can do depends on their role.
- A viewer sees no create, edit or delete controls.
- A viewer calling a write endpoint directly is refused.
- An admin can change another user's role and deactivate a user.
- The last active admin cannot be demoted or deactivated.

**F-3 Audit trail.** Every change is traceable.
- Creating, changing or removing any business record adds an audit entry with who, when and what changed.
- Each record's page shows its history, newest first.
- Admins can browse the full audit log and filter by person, record type and date.

## Vendor register (M1)

**V-1 Vendor list.**
- Shows name, category, status, criticality and owner for every vendor.
- Can be searched by name and filtered by category, status, criticality and owner.
- Can be sorted by any column. Filters and sorting survive a page reload.
- Offboarded vendors are hidden unless a filter includes them.

**V-2 Add and edit a vendor.**
- An editor can add a vendor with the required fields from the domain model.
- A second vendor with the same name (ignoring case and surrounding spaces) is rejected with a clear message.
- Missing or invalid fields are pointed out next to the field, and nothing is saved.

**V-3 Vendor page.**
- Shows all vendor details, contacts, document links, and tabs or sections for contracts, spend and scorecards (empty until those milestones).
- An editor can add, edit and remove contacts and mark one as primary.
- An editor can add and remove document links; only https links are accepted.

**V-4 Vendor status.**
- An editor can change status. Setting a vendor to offboarded is refused while it has an active contract, with a message naming the contract.

**V-5 Categories.**
- An admin can add, rename and deactivate categories. A deactivated category stays on existing vendors but cannot be chosen for new ones.

**V-6 Export.**
- The current filtered vendor list can be downloaded as a CSV file that opens correctly in Excel.

## Contracts and renewals (M2)

**C-1 Add and edit a contract.**
- An editor can add a contract to an active vendor with the fields from the domain model.
- An end date before the start date is rejected.
- Values are entered as normal amounts (for example 12,500.00) and shown with their currency.

**C-2 Contract list.**
- Shows all contracts with vendor, title, status, end date, notice deadline, annual value and owner.
- Can be filtered by vendor, status, type, owner and renewal state, and sorted by any column.

**C-3 Renewal view.**
- A dedicated page lists active contracts whose notice deadline is overdue or within a chosen window (30, 60, 90 or 180 days), soonest first.
- Overdue contracts are visually distinct from those due soon.
- Open-ended contracts never appear here.

**C-4 Renewal decision.**
- An editor can record renew, renegotiate or terminate with a date and note.
- A contract with a decision for the current term leaves the renewal view.
- Choosing renew offers to roll the dates forward by the renewal term.

**C-5 Contract page.**
- Shows all details, the derived notice deadline and renewal state, document links, decisions and history.

**C-6 My renewals.**
- The signed-in person sees a count of their own contracts needing a decision in the page header, linking to the renewal view filtered to them.

**C-7 Export.** The filtered contract list can be downloaded as CSV.

## Spend (M3)

**S-1 Manual entry.**
- An editor can add, edit and remove a spend entry for a vendor, optionally linked to one of that vendor's contracts.

**S-2 Upload.**
- An editor can upload a CSV or Excel file of spend rows.
- A downloadable template shows the expected columns: vendor name, date, amount, currency, description, invoice reference.
- Before anything is saved, a preview shows which rows are valid and why the others are not (unknown vendor, bad date, bad amount).
- The editor can import the valid rows or cancel. Nothing is saved on cancel.
- Uploading the same file twice warns that it looks like a duplicate.

**S-3 Undo an upload.**
- The list of past uploads shows file, person, date and row count. An editor can revert an upload, which removes its rows.

**S-4 Spend views.**
- The vendor page shows spend per month and per year, and total versus the annual value of its active contracts.
- A spend overview lists vendors ranked by spend for a chosen period, with totals per currency.

**S-5 Export.** Spend entries for a chosen period can be downloaded as CSV.

## Performance (M4)

**P-1 Criteria.**
- An admin can add, edit, weight and deactivate scorecard criteria. The starting set is loaded at installation.

**P-2 Create a scorecard.**
- An editor can start a scorecard for a vendor and period, score each active criterion from 1 to 5 with an optional comment, and save it as a draft.
- Finalising requires a score on every criterion. A final scorecard is read-only.
- An admin can reopen a final scorecard.

**P-3 Results.**
- The vendor page shows the latest overall score, the scores per criterion, and the trend across past scorecards.
- A performance overview lists vendors with their latest score and review date, and can be filtered to low scorers (below 3.0) and to vendors not reviewed in the last 12 months.

## Dashboard (M5)

**D-1 Home dashboard.** The landing page shows, each linking to the detail behind it:
- Contracts needing a decision: overdue and due within 90 days.
- Top 10 vendors by spend for the current year.
- Spend per month for the last 12 months.
- Vendors with a latest score below 3.0.
- Data quality: active vendors without a primary contact, without a contract, without a scorecard in 12 months, and high or critical vendors without an owner who is still active.

**D-2 Performance of the app itself.**
- With 500 vendors, 1,500 contracts and 50,000 spend entries, every page loads in under 2 seconds.

## Throughout

**X-1** Every page works with keyboard only and passes automated accessibility checks.
**X-2** Empty lists explain what belongs there and offer the action to add the first item.
**X-3** A failed save keeps what the person typed and says what went wrong.
**X-4** Dates are shown as day month year (for example 21 Nov 2026).
