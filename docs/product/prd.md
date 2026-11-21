# Product requirements document

Working name: to be chosen (see `../open-questions.md`). Called "the app" below.
Detailed acceptance criteria are in `requirements.md`; fields and rules in `domain-model.md`.

## 1. Problem

The VS Finance team manages around 50 vendors, 50 master agreements and 200 statements of
work by hand. The information sits in emails, shared drives and people's memory. Three
things hurt most:

1. **Nobody can say quickly when a contract renews or ends.** Notice deadlines are noticed late.
2. **Nobody can say with evidence how a vendor is performing.** Helpdesk vendors are judged on impressions, although the facts are in Jira.
3. **Running an RFP is fully manual.** Writing it, tracking candidates, comparing answers and keeping the paper trail is done in loose documents each time.

## 2. Goal

One place where the team sees every vendor, every agreement and its dates and money, a
performance score backed by real helpdesk data, and a guided RFP process, with AI doing
the reading, comparing and drafting, and people making the decisions.

## 3. Users

| Who | Count | Access |
|---|---|---|
| VS Finance team members | up to 5 | Full use of everything, including all contract values. |
| Admin (the product owner) | 1 of the 5 | Also manages users, settings, scoring rules and Jira connections. |
| IT management team, CTO | readers | No access. They receive the monthly report and RFP documents as PDF, Word or Excel. |
| Vendors | none | Never have access. Everything from them arrives by email and is uploaded by the team. |

There are two roles only: **admin** and **member**. There is no restricted or read-only role.

## 4. Vendors in scope

Software vendors, consultancy and implementation partners, and IT research or advisory
firms (for example Gartner, APQC). No hardware, telecom or facilities. Scoring can be
switched off per vendor, for example for research firms.

## 5. What the app does

### 5.1 Vendor register
One record per vendor: type, status, owner, contacts, whether it is scored, and whether an
NDA and a data processing agreement are required.

### 5.2 Agreements
Five kinds, all linked to a vendor:

- **MSA**: master agreement. Runs indefinitely.
- **SOW**: statement of work, the main kind. Project based, usually under an MSA, with a start, an end and a budget. Not subject to renewal.
- **Subscription**: software subscription. Renews, with a renewal date, notice period and auto-renewal.
- **NDA** and **data processing agreement**: recorded as in place, signed on, valid until.

Every agreement has a light status (draft, in negotiation, out for signature, active,
ended) and can have its documents uploaded. The documents are stored inside Databricks.

### 5.3 SOW delivery and money
Per SOW: fixed price or time and materials, budget, milestones (with payment amounts on
fixed-price SOWs), change requests and extensions, named consultants, and invoices keyed in
by hand against the SOW. The app shows budget versus invoiced. Day rates are held as a
rate card per vendor and role. Subscriptions also receive invoices. Amounts are in EUR or
GBP, with a EUR total using an exchange rate the admin sets. PO numbers are not tracked.

### 5.4 Performance from Jira
Each helpdesk vendor has its own Jira Service Management board (Jira Cloud). The app
connects to Jira, and every month calculates per vendor: first response time, first-line
closure rate, SLA breaches, backlog age and customer satisfaction. Each vendor has its own
targets from its contract. A missed target is flagged; calculating service credits is left
to the team for now.

### 5.5 Scorecards
Monthly, the AI proposes a 1 to 5 score per measurable criterion with the evidence behind
it, and summarises recurring themes from ticket text. Quarterly, a team member reviews,
adjusts, scores the criteria Jira cannot measure, and finalises. Vendors without a Jira
board are scored by hand, supported by facts the app already holds (milestones delivered
on time, budgets kept). A final scorecard can be exported as a PDF for the vendor, without
internal notes.

### 5.6 Warnings and risk flags
Inside the app only, no email:

- Subscription notice deadline within 90 days, or passed.
- SOW ending within 30 days.
- SOW budget 80% invoiced or more.
- Required NDA or data processing agreement missing or expired.
- Operational risk flags: budget heading for an overrun, SLA performance getting worse, a SOW about to end with open milestones.

### 5.7 Briefings and reporting
- **Vendor briefing**: an AI-written preparation for a vendor review meeting, with agreement status, spend against budget, SLA performance and trend, open issues, upcoming dates and suggested talking points. On screen and as PDF.
- **Monthly management report**: for the IT management team, one or two pages as PDF, with spend against budgets, agreements ending soon, vendor scores with trend, SLA breaches and open RFPs.
- **Dashboard**: the landing page, showing what needs attention now.

### 5.8 RFP
About three a year. The app follows the team's existing process:

1. Record the approved demand: what is needed, budget, sponsor, target date.
2. Draft the RFP from a template with AI help: sections and a numbered question list, each question tied to a weighted criterion.
3. Internal review. Reviewers outside the team (CTO, other IT teams) receive an exported Word or PDF; their sign-off is recorded.
4. Longlist and shortlist of candidates, entered by hand with a reason for each.
5. Issue: export the RFP as Word and the question list as Excel per candidate. The app warns if a candidate has no NDA.
6. Upload each candidate's answers. The AI summarises and compares them per question and proposes scores.
7. The team scores per criterion; the app calculates the weighted overall score. Demos and interviews are scored as a separate weighted part.
8. Record the winner and the reasons. The winner becomes an active vendor. The contract itself is created later, by hand.
9. The whole trail can be exported as a decision record.

### 5.9 Ask a question
A chat where a team member asks in plain language, for example "which SOWs with vendor X
end this quarter?", and gets an answer with links to the records it came from.

### 5.10 Contract reading
Upload a contract and have the AI propose the field values for a person to confirm. Lowest priority.

## 6. Principles for AI

- **Suggest and confirm.** The AI never records a score, a field value or a decision by itself. Every AI output is a proposal a person accepts, changes or rejects.
- **Show the evidence.** A proposed score shows the numbers and tickets behind it. A chat answer links to its sources.
- **Stay inside the company.** In production the AI is a model hosted in the company's Databricks workspace. Contract and ticket text never leave it.
- **Marked as AI.** AI-written text is labelled as such until a person has confirmed it.

## 7. Out of scope for version 1

Vendor access; reviewers outside the team working inside the app; email or Teams
notifications; service credit calculation; licence counts and price per seat; time sheets
or days worked per consultant; PO numbers; invoice approval; the AI searching the internet
for RFP candidates; automatic contract creation from an RFP; links to finance systems;
languages other than English.

## 8. Backlog after version 1

Service credit calculation; in-app review for people outside the team; email or Teams
warnings; unusual-clause detection in contract text; award and rejection letters.

## 9. Priorities

Build order, which is also the order in which things survive if time runs out:

1. Vendors and agreements with warnings
2. SOW budgets, milestones, invoices, consultants
3. Jira performance data
4. AI scoring and scorecards
5. Briefings, risk flags, dashboard, management report
6. RFP
7. Chat
8. Contract reading

## 10. How it is built and delivered

The app is built outside the company, on the owner's personal setup, and moved to the
company's Databricks workspace through GitHub when it is finished. Consequences:

- **No real company data during the build.** Sample vendors, contracts and tickets are invented. Real data is entered after the move.
- **Company-only services are replaced by stand-ins during the build**: sign-in, the database, file storage, Jira and the AI model. Each sits behind one small connection point so the real one can be switched on at deployment.
- **Deployment has a small budget** (about 400 dollars of AI assistance at work). The app therefore includes a system check page that tests every connection and says in plain language what is wrong, and a step-by-step deployment guide.
- The owner may bring privately built software into the company for self-supported apps, and can download from GitHub on the work laptop.

## 11. Success measures

- Every active vendor has an owner, and its required NDA and data processing agreement are in place or flagged.
- The renewal or end date of any agreement can be found in under 30 seconds.
- Every helpdesk vendor has a monthly score backed by Jira data, with no manual counting.
- A vendor briefing is ready in under a minute.
- An RFP runs from demand to decision record without a separate spreadsheet.

## 12. Size

Up to 5 users, 50 vendors, 50 MSAs, 200 SOWs, a few thousand invoices, and tens of
thousands of Jira tickets over time.
