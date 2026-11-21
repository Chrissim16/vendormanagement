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

Kind labels that belong to a record (SOW, Approved) may use the brand tint. The label text
always says what the colour means, so nothing relies on colour alone. Dashboard summary
tiles are neutral so they do not compete with the pills below them.

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
- The dashboard opens with a greeting that states what needs doing, three neutral tiles, then what needs attention.

## Forms and dialogs

- Adding or editing a record happens in a dialog over the page: 24px radius, the same shadow as the side panel, a dimmed page behind. It rises into place with the spring.
- Focus starts in the first field, stays inside the dialog, Escape closes it, and focus returns to the button that opened it.
- Fields sit in two columns with the label above each field. Only the fields that apply are shown; choosing a different kind empties the ones that no longer apply.
- A problem is written under its field in red text, and a summary sits above the buttons. Nothing typed is lost when saving fails.
- An amount shows what the app understood under the box ("Read as € 12,500.00") before anything is saved.
- The buttons are bottom right: Cancel, then the one primary action named for what it does.
- A file is attached with an "Attach document" button, never a bare browser file box. Type and size are checked before sending.
- Sections inside a panel are tabs with a sliding underline; arrow keys, Home and End move between them.

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
| Search field | The hint text slides up to a new suggestion every few seconds. |
| Scoring | The selector thumb snaps to the chosen score with a bounce. Accepting an AI suggestion and finalising throw a short burst of small coloured squares. |
| Theme switch | The new theme spreads in a circle from the button. |

Rules: nothing wiggles or shakes. Hover effects are a lift or a small shift, nothing that
loops. Standard easing `cubic-bezier(.2,.8,.2,1)`; spring `cubic-bezier(.34,1.5,.5,1)`;
180ms for small changes, 300 to 480ms for larger ones. Everything respects the reduced
motion setting.

## AI in the interface

AI works quietly inside the pages; there is no assistant panel. A suggestion sits next to
the thing it concerns, on the brand tint, labelled "AI suggests", with a link to the
evidence and an accept button. The suggested value is shown as an outline until a person
accepts it, and only then becomes filled. Once accepted or overridden, the suggestion
slides away.

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
| Charts | Recharts |
| Search and Ask bar | cmdk |
| Icons | Lucide |
| Toasts | Sonner |
| Theme switch | The browser's View Transitions feature, no library |

Settled at M0: Databricks AppKit's component set is not used. It is built on the same
foundations (shadcn, Radix) but brings its own look and a different chart library, so the
app uses the list above. Components are written in the repository in the shadcn manner.
TanStack Table and Recharts are added when the first screen needs them (M1 and M2).
Faint text was darkened from the prototype so small labels meet contrast requirements.
