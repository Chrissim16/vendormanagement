---
name: status
description: Report where the vendor management project stands, in plain language for a non-developer. Use when the owner asks for status, progress, what is done, what is next, or runs /status.
---

# Project status

Read `docs/plan/progress.md`, `docs/plan/implementation-plan.md` and
`docs/open-questions.md`. Check `git log --oneline -15` and `git status` to confirm the
log matches reality, and if code exists run `npm run check` to see whether it is healthy.

Answer in this order, briefly, with no technical terms:

1. **Where we are.** Which milestones are done and what the owner can do in the app today.
2. **What is next.** The next milestone and what it will add.
3. **Waiting on you.** Open questions that block something, each as one question the owner can answer in a sentence. Then, separately and shorter, assumptions that do not block anything but are worth a look.
4. **Problems.** Anything broken or behind, only if there is something.

If the log and the repository disagree, say so and correct `progress.md`.
