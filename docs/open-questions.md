# Open questions and working assumptions

Agents record here anything they decided on the owner's behalf. The owner corrects what is
wrong. An answered question moves to the bottom with the date and the answer.

## Waiting on the owner

| # | Question | Working assumption until answered | Affects |
|---|---|---|---|
| Q1 | Which currency do we mainly use, and do we have contracts in others? | EUR is the default; other currencies can be chosen per contract; no conversion. | M2, M3 |
| Q2 | Who should be the first admin? | The owner's company email, set as `BOOTSTRAP_ADMIN_EMAIL` at deployment. | M0, M6 |
| Q3 | Do we have access to a Databricks workspace with Databricks Apps and Lakebase Autoscaling enabled, and who is the workspace admin? | Yes, but unconfirmed. Everything is built and tested locally until deployment in M6. | M6 |
| Q4 | Are the vendor categories and scorecard criteria in `domain-model.md` right for us? | The starting sets listed there. Admins can change both in the app later. | M1, M4 |
| Q5 | Is 90 days the right default notice period and "due soon" window? | 90 days for both. | M2 |
| Q6 | What do the spend exports from finance look like (columns, date format, decimal comma or point)? | Our own template, accepting both `1.234,56` and `1,234.56` and dates as `DD-MM-YYYY` or `YYYY-MM-DD`. A sample file would let us match the real export. | M3 |
| Q7 | Roughly how many vendors, contracts and users do we expect? | Up to 500 vendors, 1,500 contracts, 50 users. | M5 |
| Q8 | Should every colleague in the workspace be able to read everything, or should some contracts or values be restricted? | Everyone who can open the app can read everything. | M0 |

## Answered

| Date | Question | Answer |
|---|---|---|
| 2026-11-21 | Who is it for? | Our own company, internal. |
| 2026-11-21 | Version 1 scope? | Vendor register, contracts and renewals, performance and spend. Onboarding and risk are out. |
| 2026-11-21 | Where is the data today? | Scattered. The register starts empty. |
| 2026-11-21 | Where does spend come from? | Manual entry and file upload. |
| 2026-11-21 | Hosting and sign-in? | Databricks App with Entra ID. |
| 2026-11-21 | Working style? | Mostly autonomous; check in per milestone. |
