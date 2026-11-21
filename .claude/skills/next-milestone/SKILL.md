---
name: next-milestone
description: Build the next milestone of the vendor management system from the implementation plan, verify it, review it and report to the owner. Use when the owner says to continue, build the next part, or runs /next-milestone. An optional argument names a specific milestone, for example "M3".
---

# Build the next milestone

You are the lead for this milestone. You write the code yourself and use subagents for
independent checking and for documentation lookups. The owner is not a developer and has
asked for mostly autonomous work, so carry the milestone to done without asking for
approval along the way.

## 1. Orient

Read `docs/plan/progress.md`, then the milestone's section in
`docs/plan/implementation-plan.md`, then its requirements in `docs/product/requirements.md`
and the entities they touch in `docs/product/domain-model.md`. Read
`docs/open-questions.md` for assumptions that apply.

Pick the first milestone that is not done and whose dependencies are done, unless the
owner named one. If the only milestones left are waiting on the owner, say exactly what is
needed from them and stop.

Run `npm run check` before changing anything (from M1 onwards). If it fails, fix that first.

## 2. Plan the slices

Split the milestone into vertical slices, each one a thin piece of working behaviour from
database to screen, for example "add a vendor and see it in the list". Order them so the
app works after every slice. Track them with the task tools. Do not write a plan document.

If a requirement is ambiguous, choose the reading that best serves the goal in
`docs/product/brief.md`, record it in `docs/open-questions.md` with the assumption, and
continue. Stop to ask only if the answer would change the data model or the scope in a way
that is expensive to undo.

## 3. Build each slice

- Before using a Databricks Apps, AppKit or Lakebase API, ask the `databricks-researcher` agent how it currently works.
- Write the schema and migration, then the business rule with its unit test, then the endpoint with API tests for each role, then the screen, then the Playwright test named with the requirement ID.
- Reuse the form, table, empty-state and error patterns from M0. If a pattern does not fit, improve the pattern rather than writing a one-off.
- Extend the seed data so the new feature has realistic content.
- Run `npm run check`, then commit the slice with a message that says what a user can now do.

## 4. Verify and review

When all slices are in, start both of these in parallel in one message:

- `acceptance-tester` with the milestone and its requirement IDs.
- `code-reviewer` with the commit range for the milestone.

Fix every FAIL and every "must fix". Fix "should fix" findings unless there is a reason not
to, and record any you leave in the Follow-ups section of `progress.md`. After fixing,
re-run `acceptance-tester` on the criteria that failed and anything the fixes touched.
Repeat until it reports no failures. A failing test is never skipped, deleted or loosened
to get to green; either the code is wrong or the requirement is, and a wrong requirement
is changed in `requirements.md` with a note to the owner.

## 5. Close out

- Update the status table and add a log entry in `docs/plan/progress.md`: what the owner can now do in the app, written as things a user does, plus anything assumed and anything that needs their attention.
- Make sure `docs/architecture/overview.md`, `domain-model.md` and the commands in `CLAUDE.md` match what was built.
- Commit and push.

## 6. Report

Tell the owner, in plain language and a few short paragraphs: what they can now do, how to
see it, what was assumed on their behalf, and what is next. Give screenshots of the main
new screens. Leave out file names, test counts and technical detail unless something went
wrong that they need to decide on.

M3 and M4 are independent of each other. If both are next, they may be built in parallel by
two agents in separate worktrees, then merged and verified together.
