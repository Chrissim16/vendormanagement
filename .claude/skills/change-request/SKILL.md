---
name: change-request
description: Turn something the owner wants added or changed in the vendor management system into a written requirement and place it in the plan before any code is written. Use when the owner asks for a feature, a change in behaviour, or a field that is not already in docs/product/requirements.md, or runs /change-request.
---

# Handle a change request

The owner describes what they want in their own words. Building straight from that
sentence is how projects drift, so the request becomes a requirement first.

1. Read `docs/product/brief.md`, `requirements.md` and `domain-model.md`. Check whether the request is already covered, contradicts something, or falls in the brief's "does not do" list.
2. Ask the owner questions until you can describe what they want back to them and they agree. Ask about the situation that prompted it, who does it, what they see afterwards, and what should happen in the awkward cases. One short round of specific questions is better than several vague ones. Offer a recommended answer for each.
3. Write it into `requirements.md` in the existing format: an ID in the right group, a one-line statement, and acceptance criteria that can each be demonstrated in the app. Update `domain-model.md` if fields or rules change. If it reverses something in `brief.md`, update the brief too.
4. Place it: into a milestone that is not yet built, or as a new milestone at the right point in `implementation-plan.md`. If it changes something already built, list what has to be reworked.
5. Tell the owner in plain language what was written down, where it sits in the plan, and what it costs in terms of other work moving. Then build it with the `/next-milestone` loop if they asked for it now and it is small, or leave it in the plan if not.

Small corrections to existing behaviour (a label, a default, a sort order) do not need new
requirement IDs. Update the affected criterion, make the change, verify it, and note it in `progress.md`.
