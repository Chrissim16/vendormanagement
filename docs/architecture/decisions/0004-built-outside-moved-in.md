# 0004 Built outside the company, moved in through GitHub

Date: 2026-11-21. Status: accepted.

## Context
The owner builds on a personal setup, where AI assistance is plentiful, and deploys at
work, where it is limited to roughly 400 dollars. Sign-in, Lakebase, Jira, the AI models
and file storage exist only inside the company. Company data may not leave it.

## Decision
- Everything company-specific sits behind five ports with a local stand-in and a deployed implementation (see `overview.md`).
- Each port has contract tests that both implementations must pass.
- The app has a system check page that runs those tests against the real services and explains failures in plain language.
- The repository contains invented sample data only.
- `docs/runbook.md` gives the deployment steps for a non-developer.

## Consequence
About nine tenths of the app is proven before the move. The deployed implementations of
the ports are written from documentation and first run for real at deployment, so that is
where the remaining risk and the work budget go. A rehearsal on a personal Databricks
trial workspace, if one is available, would reduce it further.
