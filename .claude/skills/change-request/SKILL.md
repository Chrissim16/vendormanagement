---
name: change-request
description: Turn something the owner wants added or changed in the vendor management system into a written requirement and place it in the plan before any code is written. Use when the owner asks for a feature, a change in behaviour, or a field that is not already in docs/product/requirements.md, or runs /change-request.
---

# Handle a change request

The owner describes what they want in their own words. Building straight from that
sentence is how projects drift, so the request becomes a requirement first.

1. Read `docs/product/prd.md`, `requirements.md` and `domain-model.md`. Check whether the request is already covered, contradicts something, or falls in the PRD's out-of-scope list.
2. For a bigger change, look up how other tools deal with the same problem before asking anything. A bigger change is a new feature, a new screen, a new kind of record, or a change to how a piece of work flows: who creates a record, at what stage it is created, edited, approved or closed. Skip this step for small corrections (see the end of this file).
   - Search the web for how established vendor management, contract management and procurement tools handle it. For example, for vendors and contact persons: at what stage each is created (at first contact, at contract signing, at onboarding), who may edit them, what needs approval, what happens when a contact leaves or a vendor is retired, and how duplicates are prevented.
   - Also look for common practice in finance teams (approvals, budget control, audit trail) and for what makes such screens easy to use.
   - Search in general terms only. Never put the company's name, people, vendors or figures into a search.
   - Show the owner the findings first, as a short list of plain bullet points, each with a link to its source. Say where tools differ, and which way fits a team of at most five people. Leave out jargon, or explain it in the same bullet.
   - The findings inform the recommended answers in the next step. They do not decide anything: the owner does. Do not copy any one product's screens or wording.
   - If web search is not available, say so in one line and continue.
3. Ask the owner questions until you can describe what they want back to them and they agree. Ask about the situation that prompted it, who does it, what they see afterwards, and what should happen in the awkward cases. One short round of specific questions is better than several vague ones. Offer a recommended answer for each, drawing on the findings from step 2 where there are any.
4. Write it into `requirements.md` in the existing format: an ID in the right group, a one-line statement, and acceptance criteria that can each be demonstrated in the app. Update `domain-model.md` if fields or rules change. If it reverses something in `prd.md`, update the PRD too.
5. Place it: into a milestone that is not yet built, or as a new milestone at the right point in `implementation-plan.md`. If it changes something already built, list what has to be reworked.
6. Tell the owner in plain language what was written down, where it sits in the plan, and what it costs in terms of other work moving. Then build it with the `/next-milestone` loop if they asked for it now and it is small, or leave it in the plan if not.

Small corrections to existing behaviour (a label, a default, a sort order) do not need new
requirement IDs. Update the affected criterion, make the change, verify it, and note it in `progress.md`.
