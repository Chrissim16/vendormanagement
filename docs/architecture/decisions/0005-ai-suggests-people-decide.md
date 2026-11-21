# 0005 AI suggests, people decide

Date: 2026-11-21. Status: accepted.

Every AI output (proposed score, RFP draft, comparison, briefing, extracted field, report
summary) is stored as a suggestion with its model and prompt version and only takes effect
when a person accepts or edits it. Figures are computed by the app and passed to the
model, so a number on screen never depends on the model's arithmetic. Chat is read-only.
In production the model is a Databricks model serving endpoint, so contract and ticket
text stay inside the workspace. Scores affect vendor relationships and possibly money, so
a person stays accountable for each one.
