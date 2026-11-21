# Vendor Management System

An internal tool to keep one reliable record of our vendors, their contracts and renewal
dates, how they perform and what we spend with them.

## How this project is built

The code is written by Claude Code agents. You direct the work through three commands,
typed into a Claude Code session opened on this repository:

| Command | What it does |
|---|---|
| `/next-milestone` | Builds the next milestone from the plan, tests it, reviews it and reports back in plain language. |
| `/status` | Tells you where the project stands, what is next and what is waiting on you. |
| `/change-request <what you want>` | Records a new wish or a change as a requirement, places it in the plan, and only then builds it. |

A typical session: run `/status`, answer anything waiting on you, run `/next-milestone`,
look at the result when it reports back.

## What to read

- `docs/product/brief.md` is the one-page description of the product. If it is wrong, everything built from it will be wrong, so this is the document most worth your time.
- `docs/open-questions.md` lists what the agents assumed on your behalf. Correct anything that does not match how your team works.
- `docs/plan/implementation-plan.md` shows the milestones in order.
- `docs/plan/progress.md` is the running log of what has been done.

## Why it is set up this way

Agents build quickly when three things are true: they know exactly what "done" means,
they can check their own work, and the work comes in small pieces. This repository gives
them a written requirement with acceptance criteria for every feature, a single
`npm run check` command plus an agent that tests the running app, and a plan cut into
milestones that each deliver something you can click through.
