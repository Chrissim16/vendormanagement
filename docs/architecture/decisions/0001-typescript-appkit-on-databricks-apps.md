# 0001 TypeScript on Databricks Apps (AppKit considered, not adopted)

Date: 2026-11-21. Status: accepted.

## Context
The app must run as a Databricks App with Entra ID sign-in. The owner is not a developer,
so agents write and maintain all code. Databricks Apps runs Python (Streamlit, Dash,
Gradio, Flask, FastAPI) and Node.js (React, Express and others).

## Decision
One language, TypeScript, using Databricks AppKit (Express plus React) with Lakebase Postgres.

## Why
- This is a forms-and-tables business app with relational data, which suits a typed web stack and Postgres better than a notebook-style framework such as Streamlit.
- One language and shared types across server, client and validation give agents fast, reliable feedback from the compiler.
- AppKit is Databricks' own SDK for this platform and handles the Lakebase connection and token refresh.

## Risks
- AppKit is version 0. Mitigation: keep AppKit-specific code inside `server/platform` and `client/platform`, and check current docs before using its APIs.
- AppKit supports Lakebase Autoscaling only. If the workspace only has Lakebase Provisioned, connect with a plain `pg` pool instead; nothing else changes.

## Alternatives considered
- FastAPI plus React: two languages for no gain here.
- Streamlit or Dash: quick to start, weak for multi-page CRUD with role checks and tested UI flows.

## Revised at M0 (2026-11-21)
AppKit is not adopted as the server framework. The app has to run and be tested outside
Databricks, and AppKit's server expects a workspace. The app is plain Express and React,
which Databricks Apps runs as it runs any Node.js app. Only Databricks' standalone
`@databricks/lakebase` helper is used, inside the database port, because it handles the
database token refresh. AppKit's component set (shadcn-based, with ECharts) is not used
either; the app follows its own design guide. If the workspace only offers Lakebase
Provisioned, the database port connects with a plain pool and the credentials API.
