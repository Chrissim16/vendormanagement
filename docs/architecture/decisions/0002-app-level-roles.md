# 0002 Two roles, held in the app

Date: 2026-11-21. Status: accepted (revised the same day after the PRD interview).

## Context
At most five users, all in one team. The owner first asked for restricted access to
contracts, then agreed that with a team this small a separation is not needed.

## Decision
Two roles, admin and member, stored in the app's `users` table and enforced in server
code. Every user sees all data, including contract values. The app connects to the
database as its own service principal; identity comes from `X-Forwarded-Email`.

## Consequence
Who can open the app at all is controlled in Databricks, by who is given permission to use
the app. That list must be limited to the VS Finance team at deployment. Every admin-only
endpoint has a test proving a member is refused.
