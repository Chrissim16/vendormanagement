# Product brief

## Problem

Information about our vendors is scattered across emails, shared drives and people's
memory. Nobody can answer quickly and with confidence: which vendors do we use, who owns
each relationship, which contracts are about to renew, what are we spending, and is the
vendor doing a good job. Renewals get noticed late, which costs negotiating position.

## Who uses it

One company, internal use only. A small known group of colleagues.

| Role | What they do in the tool |
|---|---|
| Vendor manager (admin) | Maintains the register, sets up users, owns the data quality. |
| Vendor owner (editor) | The colleague responsible for a vendor relationship. Keeps their vendors, contracts, scores and spend up to date. |
| Reader (viewer) | Management, finance, audit. Looks things up and reads the dashboard. Cannot change anything. |

## What version 1 does

1. **Vendor register.** One list of all vendors with category, status, owner, contacts and documents links.
2. **Contracts and renewals.** Every contract with value, dates and notice period, and a clear view of what needs a decision soon.
3. **Spend.** Spend per vendor, entered by hand or uploaded from a spreadsheet export.
4. **Performance.** Periodic scorecards per vendor against a fixed set of criteria.
5. **Dashboard.** One page showing upcoming renewals, top vendors by spend, and vendors with low scores or missing data.

## What version 1 does not do

- Vendor onboarding, approval workflows, due diligence questionnaires and risk scoring.
- Automatic links to a finance or procurement system.
- Storing files. Documents are linked by URL to wherever they already live (for example SharePoint).
- Sending email. Renewal reminders appear inside the tool only.
- Access for vendors themselves.
- Multiple companies in one installation.

## How we know it works

- Every active vendor has an owner, a category and at least one contact.
- Every contract ending in the next 90 days is visible on one screen.
- A colleague can find a vendor's contract end date in under 30 seconds.
- Spend per vendor for the current year can be shown without opening a spreadsheet.

## Constraints

- Runs as a Databricks App. Sign-in is the company's Entra ID through the Databricks workspace.
- Data is stored in Lakebase (Databricks managed Postgres).
- The owner of this project is not a developer. Agents build and maintain it.
