# 0002 Roles are held in the app, not in the database

Date: 2026-11-21. Status: accepted.

## Context
Databricks Apps can act as the app's own service principal or on behalf of the signed-in
user. On-behalf-of access to Lakebase needs a Postgres role per user and extra workspace
admin setup.

## Decision
The app connects as its service principal. Identity comes from `X-Forwarded-Email`. The
role (admin, editor, viewer) is stored in the app's `users` table and enforced in server code.

## Why
Three simple roles do not need row-level database permissions, and this avoids a workspace
admin task every time a colleague joins.

## Consequence
Access control is only as good as the server checks, so every write endpoint has a test
per role. Revisit if some contracts must be hidden from some colleagues (open question Q8).
