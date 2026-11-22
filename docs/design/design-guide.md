# Design guide

The agreed look and feel. `prototype.html` in this folder is the reference: when this text
and the prototype disagree, the prototype wins and this file gets corrected. Every screen
follows this guide; a screen that needs something new adds it here first.

## Character

Clean, roomy and expensive, and friendly. Not editorial, not dense. Personality comes from
motion and a few touches of colour, never from decoration. Desktop only. Light by default,
with a dark mode the user switches to.

## Colour

| Role | Light | Dark |
|---|---|---|
| Page | `#FFFFFF` | `#111318` |
| Sidebar | `#F5F9FD` | `#14161C` |
| Raised surface (panel, sticky bar) | `#FFFFFF` | `#1B1E26` |
| Sunken fill (tiles, search, pills) | `#F2F6FB` | `#181B22` |
| Text | `#1A1F2B` | `#F3F4F7` |
| Secondary text | `#555D70` | `#B4B9C6` |
| Faint text | `#6A7285` | `#8E95A5` |
| Brand accent (links, chart highlight, focus) | `#0089DD` | `#39A9F0` |
| Primary fill (main button, selected score) | `#0077C8` | `#39A9F0` |
| Brand tint (AI suggestion, selected row, hover) | `#EBF5FC` | accent at 16% |
| Red text (field errors) | `#C4283D` | `#FF8D95` |
| Red fill behind white text (header count) | `#C4283D` | same |
| Critical | `#E5484D` | same |
| Warning | `#F5A524` | same |
| Good | `#0B7A53` | `#6FD8AC` |

- The blue is Mileway's. No navy fills anywhere; they read as heavy.
- Dark mode is neutral graphite, not navy.
- Colour is used sparingly: one primary button per screen, the current month in a chart, status dots, confetti.

## Status

A status pill is neutral (sunken fill, secondary text) with a 6px coloured dot in front.
The dot carries the colour; the pill itself never has a coloured background.

| Dot | Means | Examples |
|---|---|---|
| Red | A deadline or target has been missed | Overdue, 19 days late, Target missed, NDA missing on the vendor page |
| Amber | Approaching a limit | 83% used, 27 days, On hold |
| Green | Fine | Active, Met |
| None | Plain label | MSA, NDA, Fixed price, Prospect, Proposed |

A row in a list of steps (milestones) may carry the same dot without a pill: hollow for open, brand for delivered, red for late.

Kind labels that belong to a record (SOW, Approved) may use the brand tint. The label text
always says what the colour means, so nothing relies on colour alone. Dashboard summary
tiles are neutral so they do not compete with the pills below them.

A figure judged against a target says so in words next to it: a small dot, then "Met · target 95% or more"
or, in red text, "Missed · target 95% or more". "No target" is faint text with no dot. In a table of
months a missed figure is red and semibold, with a line under the table saying what red means.

## Type

Inter only, in sentence case. No monospace, no all-capitals labels, no small label above a
heading with a marker in front of it.

| Use | Size and weight |
|---|---|
| Page heading | 30px, 600, tight tracking |
| Panel heading | 24px, 600 |
| Section heading | 16px, 600 |
| Body | 14px, 400 |
| Context line above a heading, tile label | 13.5px, 500, secondary text |
| Table header | 12.5px, 500, faint text |
| Large figure | 52px (tile), 34px (overall score), 26px (fact), 600 |

Figures that line up use tabular numerals. Dates read `21 Nov 2026`. Money reads `€ 240,000.00`, always with cents, so amounts line up and an invoice of € 1,249.50 is never shown rounded.

## Shape and space

- Buttons, search field and pills are fully rounded. Icon buttons are circles.
- Tiles and panels have a 24px radius. Small controls 9 to 12px.
- Page padding is 40px with 40px between sections; content is at most 1120px wide.
- Lists are separated by hairlines, not boxed in cards. A card (border, radius, shadow) is reserved for things that float: the side panel and a sticky action bar.

## Layout

- Fixed left sidebar: Dashboard, Vendors, Agreements, Money, Performance, RFPs, Ask. A top bar with search, the theme switch and the warnings bell.
- **Lists open records in a side panel.** The list shrinks to a narrow column of names and the panel takes the rest. The selected row is marked. Closing the panel restores the list.
- Inside a panel, sections are tabs.
- A record with a lot of its own content (a SOW, a scorecard, an RFP) gets a full page.
- The dashboard opens with a greeting that states what needs doing, three neutral tiles (warnings, risk flags, scorecards due), then two columns: on the left what needs attention counted by kind and the SOWs by budget used, each with a thin meter; on the right spend as bars, vendor scores with their trend in words, the scorecards due and open RFPs. Every row leads to its detail. The button to the monthly report sits in the dashboard's header.
- A section of a page that has nothing to list says so in one sentence on the sunken fill, in place of its rows.
- A record that moves through stages (an RFP) is a full page that shows the stages as a row of numbered pills, the current one filled with the primary colour, the ones behind it on the brand tint. Under it one sunken tile says the next step in a sentence, with a button to the tab where it is done. The parts of the work are tabs; the page opens on the tab of the next step and never switches tab by itself afterwards.
- A document made of many small parts (an RFP's sections, criteria and questions) is edited as one form with one Save in a bar that stays at the bottom of the window. The bar says whether there are unsaved changes and what still stops the next step; running totals (weights adding up to 100) sit next to what they count. What is typed and not saved stays while another tab of the record is looked at, and nothing replaces it without asking.
- A report page (the monthly report, a briefing) is a full page of plain tables between hairlines, with the download as its one primary action.

## Forms and dialogs

- Adding or editing a record happens in a dialog over the page: 24px radius, the same shadow as the side panel, a dimmed page behind. It rises into place with the spring.
- Focus starts in the first field, stays inside the dialog, Escape closes it, and focus returns to the button that opened it.
- Fields sit in two columns with the label above each field. Only the fields that apply are shown; choosing a different kind empties the ones that no longer apply.
- A problem is written under its field in red text, and a summary sits above the buttons. Nothing typed is lost when saving fails.
- An amount shows what the app understood under the box ("Read as € 12,500.00") before anything is saved.
- The buttons are bottom right: Cancel, then the one primary action named for what it does.
- Removing a record that carries money or people (an invoice, a consultant, a rate) asks once more in place: the button turns red and reads "Really remove?", and goes back to rest after five seconds or when focus leaves it. No separate dialog.
- A file is attached with an "Attach document" button, never a bare browser file box. Type and size are checked before sending.
- Sections inside a panel are tabs with a sliding underline; arrow keys, Home and End move between them.
- Several choices from a shared list (a contact's roles) are one box that holds the chosen ones as tinted chips, each with its own remove button, and a text field after them. Typing filters a list under the box, A to Z; the arrow keys move through it, Enter takes the highlighted one, Escape closes it, and Backspace in the empty field takes off the last chip. Where new choices are allowed, the last line of the list offers "Add "..." as a new role"; a name that differs from one on the list only in capitals or spaces is that one. The list closes after each pick so it never covers the form's buttons. The pattern is `ChoicePicker`.
- A part of a form that is optional as a whole (the main contact of a new vendor, an address) is a group with its own small heading that says "(optional)", and a line saying what happens when it is left empty.
- A record's history is the last tab where the record has tabs. On a page without tabs it is the last section and shows the newest five changes, with "Show all" under them.

## Motion

Things slide into place; they do not just appear. Motion is quick and never blocks.

| Moment | Behaviour |
|---|---|
| Changing page | Old view slides out left, new one slides in from the right. About 0.3s. |
| Sidebar | The highlight springs to the chosen item. The logo square hops and flips. |
| Opening a record | List narrows while the panel slides in with a slight overshoot. |
| Tabs | The underline and the content slide sideways. |
| Lists arriving | Rows slide in one after another, 40ms apart. |
| Numbers | Digits roll to their value like a counter. |
| Charts | Bars grow from the baseline with a small bounce; a bar lifts and turns blue on hover. |
| Dashboard tiles | Lift on hover. No tilt. |
| Search field | The hint text slides up to a new suggestion every few seconds, until something is typed. |
| Ask | A new answer slides in from the right above the earlier ones. |
| Scoring | The selector thumb snaps to the chosen score with a bounce. Accepting an AI suggestion and finalising throw a short burst of small coloured squares. |
| Theme switch | The new theme spreads in a circle from the button. |

Rules: nothing wiggles or shakes. Hover effects are a lift or a small shift, nothing that
loops. Standard easing `cubic-bezier(.2,.8,.2,1)`; spring `cubic-bezier(.34,1.5,.5,1)`;
180ms for small changes, 300 to 480ms for larger ones. Everything respects the reduced
motion setting.

## Figures over time

A record measured month by month (a vendor's helpdesk) is a full page with a month chooser.
Each metric is one row between hairlines: its name and what it measures on the left, the
figure (26px) with its verdict and the counts behind it in the middle, and twelve small
bars on the right with the chosen month in the accent. The figure and every count are
links to the list of records behind them. The bars are decoration; a table of the same
twelve months sits below, newest first, where a month's name chooses that month.

## AI in the interface

AI works quietly inside the pages; there is no assistant panel. A suggestion sits next to
the thing it concerns, on the brand tint, labelled "AI suggests", with a link to the
evidence and an accept button. The suggested value is shown as an outline until a person
accepts it, and only then becomes filled. Once accepted or overridden, the suggestion
box goes, and one quiet line stays that says what the AI suggested and what the person
did with it ("AI suggested 4 · Accepted as it was"), with the evidence still one click away.

A longer piece of AI writing (a month's proposal) is one panel on the brand tint. Its first
line carries the "AI proposal" label, when it was written and from what, and whether it
is not reviewed yet, accepted, accepted with changes or rejected, with who and when. Its
buttons sit at the bottom: the primary one accepts. When the AI cannot answer, the page
says so in the ordinary error pattern, in place, and everything else stays usable.

AI writing that a person may take over as text (a report's summary, a briefing's summary
and talking points) uses the same panel, with "Use this text" as its primary action, then
"Reject" and "Ask again". The text the record keeps sits in ordinary boxes right below the
panel with its own Save button and a line saying whether it is saved; taking the AI's text
over fills those boxes, where it can still be changed. A link inside a sentence is underlined.

A proposal that is more than a text (a whole RFP draft) uses the same panel with its own
primary action ("Use this draft"); when using it would replace something, the button asks
once more in place. A comparison the AI makes across records (candidates' answers) is one
tinted panel, folded per criterion, that says plainly that nothing in it is a score.

What the AI read in a document (contract reading) is a tinted panel across the full width
of the agreement's page, under the heading "Read from the documents". It is a table: the
field, what the agreement holds, what the document says with "The same" or "Differs" under
it, and the passage word for word with its page behind a thin rule. A value that differs
has a tick box in front, ticked to begin with; the primary button "Use the ticked values"
is the only thing that saves, and the line next to it says so. Under the table one line
names what the document does not say, and another what the AI gave but its passage did
not bear out, which is left out. Once used or rejected, the
panel shrinks to one quiet line on the sunken fill that says what was done, by whom and
when, with the table behind "What it read" and a "Read again" button. The button that
asks for a reading sits on the document's own row; when the reading arrives the page
scrolls to the panel and the keyboard focus goes with it.

Ask is the one place where the AI's text is the page. The page is a single field with its
button, then the answers, newest first. Each answer has the question as its heading, the
AI's text in the tinted panel labelled "AI answer" with when it was written, any document
passage word for word in a white box inside the panel with its document, page and where it
is attached, and the records used as underlined links. Right under the panel, outside the
tint, "What the app looked up" lists each look-up between hairlines with the app's own
count and totals and a link to the list with the same filter: the tint is the AI's wording,
what is outside it is the app's. An answer that could not be given carries a "Not answered"
pill. There is nothing to accept: an answer is read, not saved. A failure uses the ordinary
error pattern and keeps the question in the field.

The search field in the top bar is one field for finding and asking. While empty it slides
its hints; focused ("/" from anywhere) it opens a list under it: the typed text as a
question to ask first, then matching vendors, agreements, RFPs and pages, each group under
a small heading. Arrow keys move, Enter chooses, Escape closes the list and keeps the text.

A score from 1 to 5 is chosen on a row of five squares on the sunken fill; the chosen one
is filled with the primary colour and its thumb snaps over with a bounce. The same square,
alone, shows a score that is not being edited: outlined while only the AI stands behind
it, filled once a person does.

A scorecard is a full page: the facts for the quarter in three neutral tiles, one block per
criterion between hairlines (what it is on the left, the selector on the right, then the
comment for the vendor and the internal note side by side), and a bar that stays at the
bottom of the window with the overall score, what is still to do and the one primary
action. Changes on it are saved at once, each by itself; there is no Save button.

## Words

Plain and friendly. Buttons say what happens ("Add vendor", "Finalise scorecard"). Lead
with the fact ("Notice deadline passed 12 Nov"), not the system's term for it.

## Building blocks

| Need | Library |
|---|---|
| Components | shadcn/ui on Radix, restyled to this guide |
| Styling and tokens | Tailwind CSS, with the colours and sizes above as the theme |
| Motion | Motion (formerly Framer Motion) |
| Rolling numbers | NumberFlow |
| Tables | TanStack Table |
| Charts | The app's own bars for now: a quiet tint with the latest month in the accent, growing from the baseline with a small bounce, always with the same figures in a table beside or below. Recharts when a chart needs more than bars |
| Search and Ask bar | cmdk |
| Icons | Lucide |
| Toasts | Sonner |
| Theme switch | The browser's View Transitions feature, no library |

Settled at M0: Databricks AppKit's component set is not used. It is built on the same
foundations (shadcn, Radix) but brings its own look and a different chart library, so the
app uses the list above. Components are written in the repository in the shadcn manner.
TanStack Table and Recharts are added when the first screen needs them (M1 and M2).
Faint text was darkened from the prototype so small labels meet contrast requirements.
