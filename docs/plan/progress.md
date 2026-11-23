# Progress

Newest entry first. Written for the owner, in plain language.

## Status

| Milestone | State |
|---|---|
| M0 Foundation | Done |
| M1 Vendors and agreements | Done |
| M2 SOW delivery and money | Done |
| M3 Performance from Jira | Done here; the real Jira connection is unproven until tried at work |
| M4 Scorecards and AI scoring | Done here; the AI proposals are unproven until tried with the company's model |
| M5 Briefings, risk flags, dashboard, report | Done here; the AI-written text is unproven until tried with the company's model |
| M6 RFP | Done here; the AI draft and comparison are unproven until tried with the company's model |
| M7 Ask a question | Done here; how well a real AI understands questions is unproven until tried with the company's model |
| M8 Contract reading | Done here; how well a real AI reads a contract is unproven until tried with the company's model |
| M8a Dropping files | Done |
| M10 Vendor details, contact roles, history tabs | Done |
| M11 RFP editor, review rounds, company template | Done here; the company's own template, real Word and the AI's rewriting are unproven until tried at work |
| M12 Any currency | Done here; how well a real AI reads amounts in other currencies is unproven until tried with the company's model |
| M13 Renewal calendar, handover, bigger import | Done here; how Outlook treats the calendar file and how fast a large import runs on Lakebase are to be seen at work |
| M9 Move to Databricks | Prepared here; done at work by the AI in Cursor, with you |

**Next:** M9 Move to Databricks, at work: give the AI in Cursor `docs/deploy-with-cursor.md` and `docs/runbook.md` and follow along.

## Log

### 2026-11-23 M13 Renewal calendar, handover and bigger import done
What you can now do:

- **See renewals on a calendar.** Agreements has a third tab, Calendar. It shows each active subscription's notice deadline (until a renewal decision is recorded) and its renewal date, as the next twelve months grouped by month or as a month to page through. Deadlines that passed without a decision sit at the top, marked overdue. Filter by vendor and by kind of date; the choice stays after a reload. "Download for Outlook" saves what is shown as a calendar file, with a reminder on each notice deadline as many days ahead as your warning setting.
- **Hand over when someone leaves.** On the People page, switching off someone who still owns vendors, agreements or RFPs first lists what they own and asks who takes it over: one person for everything, or a person per record. They are switched off once nothing is left in their name, and every record's history shows the new owner and who made the change.
- **Import more, as anyone.** Import is in the main menu for the whole team. The template has five sheets: vendors, contacts (several roles separated by semicolons; a new role is added to the list), agreements, day rates and past invoices (by the same rules as typing an invoice in, in the agreement's currency). Records already there are left alone. Good rows are saved; the rows with a problem can be downloaded with the reason beside each, fixed and uploaded again. Imported invoices count toward budgets and warnings.

How it was checked: the full set of automated checks passes, an independent tester used all three in the running app as admin and as members, and a code review read every change. The review found a rare timing gap (a record given to someone at the very moment they were being switched off could stay in their name) and a few smaller things; all are fixed. The tester found one gap: in the month view a date showed only the vendor; it now shows the kind of date, the vendor and the subscription.

Decided on your behalf (`docs/open-questions.md`, Q126 to Q132): the calendar is a tab under Agreements; it shows each subscription's current term only; a contact row without an email is the same person as a contact of that name; the import never takes the main contact from someone; Import sits in the main menu.

To see at work (W13, W14): how Outlook treats the calendar file (long reminders, opening a newer file), and how long a large import takes on the company's database.

### 2026-11-23 Three requests from a side branch written down again, and three finished pieces brought in
You asked to look at the other branches. Three held finished work, now brought in and checked together with everything else: dropping files onto the app (several at once, on agreements, RFP responses and the import page), NDA and DPA warnings that lead straight to the agreement being worked on, and a change to how requests are written down (looking at how other tools do it first). The full set of automated checks passes on the result, and an independent tester checked dropping files and the warnings again in the running app. It found one gap, now fixed with a test: in Ask, a vendor with no NDA at all linked to the vendor instead of opening the form to add one, as the warnings page does. Both now use one rule.

The fourth branch held three requests that were written down but never built, against a much older plan. You still want all three, before the move. They are now written down again, as part M13, after your answers:

- **Renewal calendar (A-9).** A page with the notice deadlines and renewal dates of active subscriptions: a month you can page through and a list of the next twelve months. Overdue deadlines are marked, each entry leads to its subscription, and a deadline goes once a renewal decision is recorded. Filters by vendor and by kind of date. A button downloads what is shown as a calendar file for Outlook or Teams, with a reminder as many days before each notice deadline as the warning setting. No live link, because Outlook could not sign in to the app inside Databricks.
- **Handover when someone leaves (F-6).** Switching off a person who owns vendors, agreements or RFPs first shows what they own and asks for a new owner, for everything at once or one by one. Only then are they switched off. Each handover is in the record's history.
- **Bigger Excel import (A-8 changed, M-9).** Any team member may import, not only admins. The template gets sheets for contacts (with roles; a new role is added as in the form), day rates and past invoices (by the same rules as typing an invoice in, in the agreement's currency). Records already there are left alone. Good rows are saved; rows with a problem can be downloaded with the reason, fixed and uploaded again. Imported invoices count toward budgets and warnings.

What it costs: M13 is a medium-sized part, mostly the import. The move to Databricks waits until it is done, so it starts with everything.

Decided on your behalf (see `docs/open-questions.md`, Q122 to Q125): several roles in one cell are separated by semicolons; any sheet of the template may be left empty; decided and cancelled RFPs are handed over too; calendar entries are all-day events.

### 2026-11-22 Ready for the move to Databricks
You chose how the move is done: the AI in Cursor on your work laptop carries out the steps through its Databricks connection, while you watch. Your rules for it: it changes only settings (never the program), it tells you before it creates anything, you type the Jira access key yourself, it never sends anything back to GitHub, and when something needs more than a setting it writes a report that you bring back here.

What is ready:

- **Instructions for the AI in Cursor** (`docs/deploy-with-cursor.md`): every step, what it may and may not do, what to check after each step, which problems are settings it may fix and which go in the report, how to go back to an earlier version, and the report to write.
- **Your guide** (`docs/runbook.md`), rewritten for this way of working: what happens at each step and what you should see, including the Word template and a first review round, going back to an earlier version, and backups.
- **Checked against Databricks' current documentation** as far as it could be read from outside the company. It confirms that Databricks installs and builds the app itself and how the six connections are named. Five things can only be confirmed at work, and both guides say what to watch for: how Databricks passes the signed-in person's email, the older kind of database, saving files to the storage folder, calling the AI models, and the limit on upload size.
- **Two small safety changes:** the app now refuses to start while the Jira address is still the placeholder, as it already did for your email; and the start setting no longer depends on a feature that only newer versions of Node.js have.
- **A last full pass:** an independent tester went through every part of the app once more, as a member and as the admin. Everything passed. The full set of automated checks passes too. One older check failed just after midnight, because it counted the day in a different time zone than the app; the check was wrong, not the app, and it is corrected.

On 23 Nov 2026 this work and the currency work (M12, below) were brought together onto the branch GitHub opens by default (`claude/jolly-curie-d4v8z0`), and the full set of automated checks passes on the result. Before you go to work: have the company's Word template ready with [Title], [Date] and [Version] typed on its cover page, and the real exchange rates for the dollar and the three kronor (see M12).

### 2026-11-22 M12 Any currency done
The app now handles any currency, with the euro as the main one.

What you can do in it:

- **Keep the list of currencies (admin).** Settings has a section "Currencies and exchange rates". It starts with euros, pounds, US dollars and Swedish, Norwegian and Danish kronor. "Add a currency" takes any standard currency with cents, such as Swiss francs, with its rate. A currency without cents (the yen) or with three decimals is refused, with the reason. A currency can be removed only while nothing uses it; otherwise the page says what still does. The euro is always 1.
- **Set each rate as 1 euro = so much**, the way banks publish it. While you type, the row shows what € 100.00 comes to, so a rate typed the wrong way round shows at once. Each row says who set the rate and when. Until someone does, the row has a pill "Starting rate, not yet set by an admin", and every euro total that uses that rate says so too. Every change is in the list's history.
- **Use any listed currency** for an agreement, a day rate, an RFP budget, or a row in the Excel import. A currency box shows "SEK · Swedish krona". Amounts show €, £ and $ with their sign, and every other currency with its code (SEK 85,000.00), so kronor of different countries cannot be mixed up.
- **See totals in euros first.** The Money page, the dashboard, the monthly report, briefings (on screen and in the PDFs), a vendor's Money tab and Ask all show one euro total marked "converted to euros". A line beneath it gives each currency ("€ 120,000.00 · $ 30,000.00 · SEK 85,000.00"), followed by the rates used. Lists show euros with the original in brackets: € 27,777.78 ($ 30,000.00). Both file downloads have a column in euros.
- **Unchanged:** an invoice is always in its agreement's currency, so a SOW's budget against invoiced is never converted. Changing a rate changes only converted figures; no amount you typed changes. A briefing keeps the figures and rates of the day it was made.
- **Contract reading and Ask know every listed currency.** A contract amount in dollars or kronor is offered with its currency. An amount written only as "kr", or in a currency not on the list, is left out; for the second, the page names the currency so you know what an admin could add.

The sample data has four more invented vendors billing in Swedish kronor, Norwegian kroner, US dollars and Danish kroner. The pound's rate looks set by an admin; the other four keep their starting rates, so you can see the notices.

How it was checked: an independent tester went through every point in the running app. They worked out several converted totals by hand (each currency, the twelve-month total and a month), changed rates and compared again to the cent, and confirmed that a briefing kept its old figures. They also tried every refusal both on screen and directly, as a member and as an admin, plus the keyboard, dark mode and a narrow window. Every criterion passed. An independent reviewer read all the code and found one thing that had to be fixed and several that should be; all are fixed, each with a test, and the full set of automated checks passes. The ones that mattered:

- **The real AI would have ignored dollars and kronor in contracts.** The instructions for the company's model still said only euros and pounds exist; the stand-in ignores those instructions, so nothing showed here. They now ask for any currency's code, and say that "kr" alone gives no currency.
- **A rate like "17,250" would have been read as 17.25,** a thousand times off. A comma before three digits is now refused with a request to write the rate with a point.
- **An amount typed with another currency could slip in.** "SEK 285,000" on a euro agreement, or in a euro row of the import, would have been saved as € 285,000. Now the sign or code must match the record's currency; the import says which currency was typed.
- **Ask could have refused good answers.** It treated "€" and "EUR" as different currencies, and read "in 2026 USD invoices" as an amount. Both are fixed.
- **Two sample names resembled real companies;** they are renamed.

Smaller fixes from testing: an amount never breaks across two lines on any screen; a vendor's Money tab names the rates used; a form says so when an amount was typed in another currency than its record's; a contract amount in a currency not on the list is named as such. The tester went over every fix again in the running app.

Needs your attention:

- **No real AI model has been tried, again.** There are three new invented test cases for reading amounts in other currencies. The two the stand-in can take pass; the one with kronor written as "285 000" waits for the company's model.
- **Check the four starting rates** (dollar and the three kronor) in Settings and save the real ones before relying on euro totals.

Decided on your behalf (see `docs/open-questions.md`, Q114 to Q119):

- Which pages show euros with the original in brackets: totals and money lists; a record's own page shows its own currency.
- Amounts written with spaces between the thousands ("SEK 1 250 000") are read as one number.
- A monthly report is worked out afresh at today's rates, like all its figures; only a briefing is kept as it was. The requirement said otherwise and was corrected.
- An ambiguous rate ("17,250"), and an amount typed in another currency than its record's, are refused rather than guessed.

### 2026-11-22 Change request: any currency, euro as the main one
You asked for the app to handle any currency, not only euros and pounds, with euro always the main one. After your answers it is written down as requirement M-8 and planned as M12, after M10 and M11 and before the move to Databricks.

What it will do:

- **A currency list in Settings.** It starts with euros, pounds, US dollars and Swedish, Norwegian and Danish kronor. An admin can add any other currency that uses cents, such as Swiss francs. Currencies without cents, such as the yen, are refused.
- **One rate per currency, written as 1 euro = X**, the way banks publish it (1 EUR = 11.49 SEK). Settings shows who set each rate and when. Until someone enters the real rates, rough starting rates are used and every euro total says so.
- **Euro totals first.** Every total that mixes currencies shows one euro amount, marked as converted, with a small line beneath naming the amount in each currency it contains. Lists show euros with the original amount in brackets.
- **Unchanged:** an invoice is always in its agreement's currency, so a SOW's budget and what was invoiced against it are compared without conversion. Changing a rate never changes an invoice, only the euro totals.
- Kronor are shown with their code (SEK, NOK, DKK) so they cannot be confused; the euro, the pound and the dollar keep their signs.

What it costs: the change touches parts that are already built (Settings, the Money page and its exports, the dashboard, the monthly report, briefings, Ask, contract reading, the forms and the import), so it is a medium-sized piece of work rather than a small fix. Nothing else in the plan moves, except that M9, the move to Databricks, waits until it is done; that is on purpose, so the move starts with the final database layout.

Decided on your behalf (see `docs/open-questions.md`, Q109 to Q113): the starting rates; that kronor are shown by their code; that a contract amount written only as "kr" is left out because it does not say which kronor; that a currency can only be removed while nothing uses it; and that the pound rate already saved is carried over turned round.

### 2026-11-22 M11 Writing and reviewing the RFP done
What you can do now:

- **Format the RFP's text.** Each section of an RFP is written in an editor with a small toolbar: bold, italic, a heading and a smaller heading, bullet and numbered lists, and tables. Every button has a keyboard shortcut (Ctrl+B for bold, for example), and the Tab key moves between table cells and otherwise leaves the editor, so it never gets stuck. The AI's first draft now arrives formatted too, with lists and a table for the timeline. Text written before keeps exactly what was typed, as plain paragraphs.
- **Get the same in Word.** The Word file has the same headings, lists, bold, italic and tables as the screen.
- **Have the AI rewrite one section.** Under each section, "Rewrite with AI" asks what should change ("shorter", "turn the requirements into a list") and lets you tick reviewers' remarks to rewrite for. The rewrite appears under the section next to the current text, with the words it takes out struck through in red and the words it adds marked in green. Nothing changes until you choose "Use this text", "Edit before using" or "Reject". Using it marks the remarks it was for as dealt with. It is refused on an approved, issued, decided or cancelled RFP, and a rewrite of a text someone changed since cannot be used.
- **Run review rounds in Word.** On the Review tab, "Download the review copy" makes version 1, then 2, and so on; the version is on the cover page and in the file name. Downloading again without a change gives the same version. Reviewers comment and make tracked changes in Word and send the file back. You upload it to its round and the app reads every comment (with the words it was made on, and replies) and every tracked change (what would go and what would come), with the reviewer's name, and puts each next to the section it is in. What stands outside the sections, such as a comment on a question, is listed under "Not placed", where you choose its section.
- **Deal with each remark.** For each one: "Take over this edit" (changes the section, only where the words still stand once, as whole words; otherwise the page says to do it by hand), "Ask the AI to rewrite for it", "Dealt with by hand", or "Set aside". Each says afterwards who did what and when, and can be opened again. The RFP cannot be marked as approved while any remark of any round is open. Earlier versions stay downloadable with all their remarks and what was done with each.
- **Use the company's Word template (admins).** On the settings page, "Word template": upload the company's template (.dotx or .docx) and the app lists what it found, each with Found or Missing: the cover page, where [Title], [Date] and [Version] are, header, footer, pictures (the logo), the font, and the heading, list and table styles, with what it does where something is missing. Every RFP Word file, the review copy and each candidate's copy, then uses it: the template's cover page with the title, the day and the version filled in, its header, footer, logo, fonts and spacing, and its own styles for the RFP's text. A new upload is used from then on; "Use the plain layout instead" goes back to the app's own simple layout. The settings history records each change.
- **No review PDF any more.** Reviewers get the Word file; Word can save it as PDF itself. The decision record stays a PDF.

The sample data has a fourth invented RFP, "Travel booking tool", in review: version 1 came back from two invented reviewers with comments, a reply and tracked changes; one edit is already taken over. The invented "Larkspur & Vale" template, with a made-up logo, is in use; it is drawn by the app itself, so no template file sits in the project.

How it was checked: an independent tester went through every point of Q-12, Q-13, Q-14 and the change to Q-3 in the running app, with returned files made in three ways (the app's own reviewer stand-in, LibreOffice with real tracked changes, and python-docx), awkward templates (marks split by formatting, no styles, no marks, macros), files of other RFPs and versions, the AI switched off, keyboard only, dark mode and a narrow window. Two things failed and are fixed, each with a test:

- **A taken-over edit could be lost.** With unsaved typing on the Document tab, taking an edit over on the Review tab worked, but the next Save wrote the old text back over it. Now the Review tab says the document has unsaved changes and does not allow taking an edit over until they are saved or discarded.
- **The AI rewrite failed on sections with a date at the start of a table line**, such as the sample "Timeline and process". The check that stops the AI from inventing figures misread such a date. Fixed for every AI text that is checked this way.

An independent reviewer read all the code and found three things that had to be fixed and seven that should be; all are fixed, each with a test:

- **A suggested edit could change the wrong words.** Changing "30" to "60" could have turned "300 users" into "600 users", and an edit could land in the middle of a word. Now edits only ever match whole words, and when the words around an edit have changed, it is found by its own words only if they are distinctive (two words or more, or a word of six letters or more).
- **An edit to a heading was applied to the text.** A reviewer renaming "Scope" to "Scope of work" changed the first "Scope" in the text instead. Now it is shown as "in the heading" and taking it over renames the heading.
- **A specially made Word file could have frozen the app.** Some ways of reading Word files took far longer on crafted files. Every reading of an uploaded Word file now goes through the file once, from left to right, and takes a moment whatever is in it.
- Also fixed: a template with comments or tracked changes left in it is refused (they would have gone to vendors); a trial file is made from every uploaded template, so one the app cannot make a sound file from is refused at once; headings stay recognisable in returned copies when a template has no heading style; tables pasted from Word with merged cells keep their columns; a table row of dashes is kept; words added next to bold text are not made bold; and the note that a returned file belonged to an earlier version now stays on the page.

Needs your attention:

- **At work, try the company's template and real Word** (W10 to W12 in `docs/open-questions.md`). Upload the template with [Title], [Date] and [Version] typed on its cover page, read what the app found, download one review copy and open it in Word. Then have one colleague comment and track changes in Word, send it back, and upload it. The app recognises a returned copy by two hidden properties in the file; Word keeps them, as widely reported, but Microsoft does not promise it, and a file saved through some SharePoint routes may lose them. If so, the upload says it is not a review copy.
- **No real AI model has been tried, again.** The stand-in makes a reviewer's edit and turns text into a list or shortens it by simple rules; for anything else it leaves a note in square brackets. There are four new invented test cases for the rewrite; the two the stand-in can take pass, and two (leaving a gap instead of inventing a fact, not following an instruction hidden in the text) wait for the company's model.
- **The editor is for desktop screens.** On a phone-sized window it is squeezed, as the rest of the app is.

After the fixes the tester checked everything that had failed, and everything the fixes touched, once more in the running app: all passed, and the full set of automated checks passes.

Decided on your behalf (see `docs/open-questions.md`, Q97 to Q108): [Version] becomes "Version 2", so type it on its own; a candidate's copy has no version; one level of lists and tables up to 60 rows and 8 columns; a new template counts as a new version; an older version sent back goes to its own round; a reply to a comment is a remark of its own; a returned file can be removed while none of its remarks has been worked on; the AI rewrites only sections that have text and only for remarks placed in that section; the rules for taking edits over described above.

### 2026-11-22 M10 Vendor details, contact roles and history done
What you can do now:

- **Give a vendor an address and a VAT number.** The vendor form has boxes for street, a second street line, postal code, city and country code, and one for the "VAT or tax number". All are optional. The number is kept in capitals without spaces, dots or dashes, so "nl 123.456.789 b01" is stored as NL123456789B01. A number another vendor already has is refused, and the message names that vendor. The vendor's Overview shows the address as one block and the number, or "Not given".
- **Add the main contact while adding a vendor.** The form for a new vendor has a "Main contact (optional)" part: name, email, phone and roles. Fill in a name and that person is saved with the vendor as its primary contact. If something about the contact is wrong (an email without an @, say), nothing is saved and everything you typed stays. Leave it empty and the vendor is saved without contacts, as before.
- **Give contacts roles.** The job title is replaced by roles, chosen from one list for the whole team, A to Z. A person can have several. Start typing to find one; if it is not there, the list offers to add what you typed as a new role, and from then on everyone has it. "account manager" or "Account  Manager" picks the existing Account Manager instead of adding a second one. The job titles you had typed before are kept as roles.
- **Look after the list of roles (admins).** At the bottom of Settings, an admin can rename a role (every contact then shows the new name) or remove one. A role somebody still has cannot be removed; the message says who has it.
- **Find history without scrolling.** An RFP's history is now on its own tab, the last one, after Decision. Agreement, scorecard and briefing pages, which have no tabs, show the newest five changes with "Show all" under them.
- **Import addresses and VAT numbers.** The Excel import template has the new columns. A template you downloaded earlier still works.

The sample data has invented addresses (each street is named after its made-up vendor), VAT numbers and contacts with roles. Bluefinch Systems, for example, has three contacts.

How it was checked: an independent tester went through every point of the five requirements in the running app, including awkward cases (numbers written in odd ways, two vendors with one number, a refused contact, roles typed in other capitals, a member trying the admin actions, old and new import templates, long histories, keyboard only, dark mode, a narrow window). Everything passed except one point: pressing Tab in the roles box left no field selected. That is fixed. An independent reviewer read the code and found nothing that had to be fixed and seven things that should be. All are fixed, each with a test:

- **An Enter in the roles box could add a role nobody chose.** The list opened with its first role already highlighted, so Enter added "Account Manager" instead of saving. Now nothing is highlighted until you type or use the arrow keys, and the list closes after each choice so it never covers the buttons.
- **A role typed but not confirmed was dropped without a word.** It is now taken as a role when you leave the box.
- **Two people adding the same new role at once** could get "something went wrong". Now one role is added and both contacts get it. A role an admin removes while someone is saving gives a clear message.
- **Long job titles could have blocked a contact.** Job titles could be 200 characters, roles only 60. Roles may now be 200 characters too.
- **The sample addresses looked like real buildings.** They are now plainly invented.
- **The country is still a two-letter code** (NL, GB), as before.

Decided on your behalf (see `docs/open-questions.md`, Q92 to Q96):

- At most 12 roles per contact.
- "Help desk" and "Helpdesk" count as two different roles; only capitals and extra spaces are ignored.
- The twelve starting roles do not show in the roles history.
- Renaming a role is in the roles history, not in each vendor's history.
- An email or role filled in for a main contact without a name is pointed out, not quietly dropped.

### 2026-11-22 Your four requests written down
You asked for four changes. They are now part of the plan as two new parts, built here before the move to Databricks.

**Part M10: vendor details, contact roles, history.**
- A vendor gets an address (street, second line, postal code, city, country) and a VAT or tax number. Both are optional. The same number on two vendors is refused.
- The form for a new vendor has an optional main contact; when filled in, that person becomes the main contact straight away.
- A contact gets one or more roles from a shared list, sorted A to Z: Account Manager, Billing / Finance, Consultant, Delivery Manager, Developer, Executive Sponsor, Helpdesk, Legal / Contracts, Program Manager, Project Manager, Support Manager, Technical Contact. Anyone can add a missing role while filling in a contact; an admin can rename or remove roles. The job titles already typed become roles, so nothing is lost.
- The RFP's history moves to its own tab after Decision. The vendor page already has one. Pages without tabs (agreement, scorecard, briefing) show the newest five entries with "Show all".

**Part M11: writing and reviewing the RFP.**
- The RFP text gets a proper editor with headings, lists, bold, italic and tables, and the AI can rewrite a section when you ask, in your own words. A rewrite is shown next to the current text and changes nothing until you use it.
- Reviewers keep working in Word. Each review copy has a version number. You upload the files they send back; the app reads their comments and tracked changes and shows each next to its section. For each one you take it over, ask the AI to rewrite for it, edit by hand, or set it aside. An RFP cannot be approved while one is still open.
- Every RFP Word file uses the company's template: cover page, logo, fonts, spacing, header and footer. The cover gets the title, the date and the version. An admin uploads the template in the app once it runs at work, so the company's template and logo never sit in the project; here an invented example is used. The review PDF is dropped, since Word can save the file as PDF itself.

What it costs: M10 is small. M11 is about the size of one of the earlier parts. The move to Databricks waits until both are done.

Before M9, at work: type [Title], [Date] and [Version] on the template's cover page where they should appear. Decided on your behalf (see `docs/open-questions.md`, Q87 to Q91): open reviewer comments block approval; only the RFP document gets the editor for now.

### 2026-11-22 From a missing NDA to editing it in three clicks
You noticed that going from "NDA missing" on the dashboard to editing the NDA took five clicks: the warning opened the vendor, then you had to find the Agreements tab, then the NDA, then Edit. Now:

- **An NDA is being worked on** (a draft, in negotiation or out for signature): the warning opens that NDA directly. From the dashboard that is three clicks to its edit form: "NDA missing", the vendor's warning, "Edit or change status". If there are several, the one closest to being signed is opened. The warning now also names it, for example "No NDA is in place. “Mutual NDA” is in negotiation."
- **There is no NDA at all:** the warning opens the form to add one, for that vendor and with NDA already chosen, and the cursor waits in the Title field. That is two clicks from the dashboard.
- **The NDA has expired:** the warning opens the replacement if one is being worked on, otherwise the expired one, as before.
- **Data processing agreements** behave in the same way.

The same link is used in answers on the Ask page, so "Which vendors have no NDA?" now leads to Larkspur Data's NDA in negotiation. Other warnings were already three clicks from editing and are unchanged. Requirement A-7 has two new lines saying this; no new requirement was needed. The full set of automated checks passes, with new checks for each of the cases above.

### 2026-11-22 Dropping files onto the app
You asked to be able to drag documents onto the app instead of always using the button. This is now requirement X-7, built as a small step of its own before the move to Databricks. Nothing else in the plan moved.

What you can do now:

- **Drag files from your computer onto the app.** This works on an agreement's documents, on an RFP candidate's answer sheet and other documents, and on the admin Excel import page. The buttons stay as they were.
- **See where a file can go.** While you drag a file over the window, each place that takes it gets a dashed blue outline that says what dropping there does: "Drop to attach", "Drop the answer sheet here" or "Drop the filled-in template here". Nothing else on the page moves.
- **Attach several documents at once**, by dropping them or by picking them together with "Attach document". Each file is checked on its own. The fine ones are attached, a message says how many ("Attached 2 documents"), and each refused one is listed by name with its reason.
- **One file only where one is meant.** The answer sheet and the Excel import take one file. Dropping several there says "Drop one file at a time", and nothing is sent.
- **Missing the spot does no harm.** A file dropped anywhere else on a page is ignored. Before, the browser would open the file itself and take you out of the app. A drop while files are still being sent is refused with a request to wait. Once an RFP is decided or cancelled, its responses take no drop.

How it was checked: an independent tester used the app in a browser. It dropped mixes of good, wrong-type, fake and too-large files, accented file names, files dropped beside the drop places and onto a half-typed answer, two drops in quick succession, a closed RFP, the keyboard alone, dark mode and a narrow window. Every point passed. An independent reviewer read the code and found nothing that had to be fixed and six things that should be; all six are fixed. The two that mattered:

- **On an RFP's responses, "Attach document" sat inside the answer sheet's drop place.** Dropping PDFs on that button was treated as an answer sheet and refused. The button now sits with the documents, in their own drop place, and refused files are listed there too.
- **In Safari the outline could vanish as soon as the pointer moved.** Safari reports moving across the page differently from Chrome. The app now only takes it as leaving the window when the pointer is really at the edge. Safari and Firefox could not be tried here; Chrome and Edge were.

The words "Drop to attach" now sit at the top of the outline, so they stay in sight on a long list of documents.

Also fixed along the way: on an RFP, a button pressed right after another one could be quietly ignored for a moment while the app refreshed other lists in the background. Buttons now work again as soon as the RFP is saved. This showed up as an automated check that failed now and then.

Decided on your behalf (see `docs/open-questions.md`, Q120 and Q121): several files are sent one after another, and one refused file does not stop the others. A file dropped on the answer sheet is checked exactly as one chosen with the button.

### 2026-11-22 Three building blocks updated
Installing the app reported eight known weaknesses, all rated moderate, in three of the outside building blocks it uses: the one that moves between pages, one used when making Excel files, and one used only by a tool for building. All three are now on versions without those weaknesses, and the install reports none. Nothing changes in how the app looks or works; the full set of automated checks passes. The notes about "deprecated" packages during install remain: those are old but working parts that other building blocks bring along, and are not weaknesses.

### 2026-11-22 Trying the app yourself
You asked where you can try the app. There is no web address for it; it runs on your own computer with one command. The guide is `docs/try-it.md`: install two tools once, fetch the project, type `npm run try`, open http://localhost:5173. It starts with the invented sample data every time and keeps nothing when you stop it.

A link you can simply open was looked into and not set up. On a hosting service's free plan the app would keep crashing, because its built-in database needs more memory than such a plan gives; it would need a separate database next to it, or a paid plan. You chose to run it on your own computer instead. What was built along the way stays in the project for later: a password gate that puts one shared password in front of everything, and a notice on every page that it is a sample version with invented data. Both are switched off unless a password is set, and cannot be switched on inside Databricks. This is written down as requirement F-5.

### 2026-11-21 M8 Contract reading done
The app can now read a contract for you and propose what to fill in, with the sentence each value comes from. As before, the AI part runs on a stand-in that works by simple rules, because the company's model cannot be reached from here (see "Needs your attention").

What you can do in it:

- **Ask the AI to read a document.** On an agreement's page, every attached document that has real text has a button "Read with AI". The agreement must exist first; a draft with only a title is enough.
- **Compare, field by field.** A blue panel across the page, "Read from the documents", shows a table: the field, what the agreement holds now, what the document says, and the passage of the document word for word with its page. Each row says "The same" or "Differs". The fields are title, signed on, start date, end or renewal date, notice period, value (a subscription's yearly value or a SOW's budget) and currency. The kind is compared too, but never changed.
- **Take over only what you tick.** Every value that differs has a tick box, ticked to begin with. Nothing changes on the agreement until you press "Use the ticked values"; then exactly the ticked values are saved, by the same rules as the edit form. If the agreement cannot take one of them (an end date before the start date, a SOW budget fixed by an approved change request), nothing at all is saved and the panel says why, with your ticks still in place.
- **Reject, or read again.** "Reject" closes the proposal without changing anything. "Read again" asks the AI anew at any time.
- **See afterwards what happened.** Once used or rejected, the panel becomes one line saying what was done, by whom and when, with the table behind "What it read". The agreement's history has a line for asking, for the values that changed, and for the review, naming the values that were taken.
- **Know what was left out.** Under the table the panel names what the document does not say. It also names any value the AI gave without a passage that really states it; such a value is not offered at all.

The sample data has an invented order form on Tarnwick Software's "Reporting suite" subscription that says a different yearly fee and notice period than were keyed in, so you can try it at once.

How it was checked: an independent tester read the sample order form and its own PDF, Word and Excel documents on agreements of every kind, compared each passage with the file, checked after every step that nothing had been saved before confirming and that nothing unticked was saved, tried values the agreement refuses, two people at once, a failing AI, the keyboard alone and a narrow window. Every point passed. An independent reviewer read the code and found two things that had to be fixed and seven that should be; all are fixed, each with a test, and the full set of automated checks passes. The two that mattered:

- **A value could be shown next to a passage that did not really say it.** The check only asked whether the numbers of a value occurred somewhere in its passage. So "1 January" could be read out of "31 January", day and month could be swapped, a payment term of 30 days could pass as the notice period, and the word "may" counted as the month of May. Now a date must stand in the passage as a whole date, an amount must have its currency right next to it, a notice period must be a number of days in a sentence about notice, and a passage may not begin or end in the middle of a word or number. A value that fails this is left out and named, and the rest of the reading stands.
- **An amount could have been saved in the wrong currency.** A fee written in dollars would have been offered as euros, and the currency could be changed without the amount. Now an amount always carries the currency written next to it, amounts in other currencies than euros and pounds are left out, and amount and currency are taken over together or not at all.

Needs your attention:

- **No real AI model has been tried, again.** The stand-in only recognises plain sentences such as "signed on 4 January 2027" or "The annual fee is € 26,500.00". Real contracts are worded more freely; a real model should cope, and the checks above apply to it just the same, but how many fields it finds has to be seen at work. There are five new invented test cases; the two the stand-in can take pass, and the three that need real understanding (contract language, not working values out, an instruction planted in the document) wait for the company's model.
- **The passage proves that the document says it, not that it is the right clause.** If a contract names a day rate and a budget, the AI could offer the day rate as the budget, with a passage that truly states that amount. That is why each value comes with its passage: read it before you tick.
- **A notice period given in months is not taken over.** "Three months' notice" is listed as left out, because three months is not always ninety days and the deadline could come out a day or two late. Fill it in by hand. Say if you would rather have it converted on the safe side (three months as 92 days).
- **Contract text reaches the AI.** It is passed as material to read and the AI is told never to follow instructions in it. In production that text stays inside the company's Databricks workspace.

Decided on your behalf (see `docs/open-questions.md`, Q80 to Q86):

- Reading starts from an existing agreement; the AI does not create an agreement from a document by itself.
- The AI proposes only what the document states. It works nothing out: no end date from a start date and a term, no yearly fee from a monthly one.
- Of a long contract the first ten pages or so are read, and the panel says so.
- Any team member may ask, use and reject; the history shows who did.
- Documents an RFP candidate sent cannot be read this way, only documents attached to an agreement.

One requirement was written out in more detail to match what was built (E-1).

### 2026-11-21 M7 Ask a question done
You can now ask the app a question in plain words and get an answer that shows where it came from. As before, the AI part runs on a stand-in that works by simple rules, because the company's model cannot be reached from here (see "Needs your attention").

What you can do in it:

- **Ask on the Ask page.** Type a question such as "Which SOWs end this quarter?", "How much was invoiced last month?", "Which vendors have no NDA?", "Tell me about Bluefinch" or "What are the milestones of SOW 07?". The answer appears in a blue panel marked "AI answer", with the day and time it was written. An empty page offers five questions to start with.
- **See what the answer rests on.** Under the AI's words, "Records used" lists the vendors, agreements, invoices or RFPs it used, each as a link to that record.
- **Check every figure in one click.** Below the panel, "What the app looked up" says in words what was looked up ("SOWs · ending 1 Oct 2026 to 31 Dec 2026"), how many the app found and any totals, with a link "Open the list" that opens the list page with exactly that filter. These counts and totals are worked out by the app, not by the AI, and are the same numbers the list page shows.
- **Ask about what a contract says.** "What does the contract with Bluefinch say about liability?" answers with the name of the document, the page, and the passage itself word for word, with links to the file and to the agreement it is attached to. This works for PDF, Word and Excel files attached to an agreement or sent by an RFP candidate; the app reads their text when they are attached.
- **Ask a follow-up.** After "Which SOWs end this quarter?" you can ask "and next quarter?".
- **Be told when the app does not know.** A question about something the app does not hold gets "The app does not hold the answer to that, so I will not guess", marked "Not answered". A vendor name the app does not know is said to be unknown; it is never quietly left out. A name written loosely ("bluefinch") is used, and the result says whom it was taken to mean.
- **Nothing can be changed by asking.** "Delete the vendor ..." gets "Ask can only look things up". There is no way for the AI to add, change or remove anything.
- **Find things from the field at the top.** The search field in the top bar now works on every page. Press "/" and type a name to jump to a vendor, an agreement, an RFP or a page; or type a question and press Enter to ask it.
- **Filter agreements by end date.** The Agreements page has two new boxes, "Ends from" and "Ends to". This is the list that "SOWs ending this quarter" links to.

The sample data now has two invented contracts to ask about: a master services agreement (PDF) with Bluefinch Systems and a framework agreement (Word) with Quillon Consulting.

How it was checked: an independent tester asked about 45 questions in the running app, worked out the counts and amounts for twelve of them from the list pages, added a SOW, 45 invoices and five documents of its own and confirmed that the answers moved with them, tried ten requests to change something and compared every record and the history before and after (nothing changed), and went through keyboard use, dark mode, a narrow window and failures of the AI. Every part of the requirement passed. An independent reviewer read all the code. Between them they found two things that had to be fixed and about twenty that should be; all are fixed, each with a test, and the full set of automated checks passes. The ones that mattered most:

- **A wrong number could have slipped through.** The app throws away an AI answer that contains a number the app did not look up. That check was too easy to satisfy: because dates were in what the AI was given, "21 SOWs" or "31 SOWs" would have passed, and so would an amount shown in euros that was really in pounds. Now a date counts as a whole and an amount counts with its currency sign, so neither can happen.
- **A specially made Word file could have frozen the app** for everyone, again at every restart. Word files are now read in a way that takes a moment whatever is in them. Text that was deleted with tracked changes is no longer read as if it were part of the contract.
- **Some links did not show the same thing as the answer.** For example "Which risk flags are there?" linked to the Warnings page, which shows everything. A link is now only offered when the page behind it shows exactly what was counted.
- **A document question could quote the wrong paragraph.** "What does the Framework agreement of Quillon say about liability?" showed the opening paragraph, because it also contains the words "framework agreement". The words that only name the document no longer decide which passage is shown, and when a word you asked about is in no document at all, the answer says so.

Needs your attention:

- **No real AI model has been tried, again.** No key for a real model was available in this build environment. For this feature that matters more than for the earlier ones. The stand-in only recognises common wordings and answers by listing what the app found; it does not really understand a question. A real model should understand free wording, pick out "only the SOW that is over budget" and combine two look-ups. There are 15 new invented test cases for it; the 8 the stand-in can take pass, and the 7 that need real understanding (for example a contract passage that tells the AI to say something false) wait for the company's model. Run them at work before relying on Ask.
- **Your questions are stored.** Each question and its answer is kept with your name, so an answer can be traced later. No screen shows them, and the conversation on screen is gone when you close the tab or press "Start over". Say if questions should not be stored, or if you would like a history.
- **Document text is found by words, not by meaning.** Asking with the words a contract uses ("liability", "termination") works; asking with other words for the same thing may find nothing, and the app then says it found nothing. A scanned document (a photo of paper) and the old .doc and .xls formats cannot be read; the agreement page says so next to such a file.
- **Text written by outsiders reaches the AI** when you ask about a contract or a candidate's document. It is passed as material to read, the AI is told never to follow instructions in it, and the passage is always shown word for word next to the answer so you can read it yourself.

Decided on your behalf (see `docs/open-questions.md`, Q71 to Q79):

- Ask covers vendors, agreements and renewals, SOW budgets, milestones and change requests, invoices and spend, helpdesk figures, scorecards, warnings and risk flags, RFPs and document text. Not yet: briefings, the monthly report, single Jira tickets, the history and rate cards.
- An answer may contain only numbers the app looked up, or numbers you typed in the question yourself.
- Of a long list the AI reads the first 40 rows; the count and totals are always of the whole list, and the answer says when only the first ones are listed.
- The last three questions go along with a new one so a follow-up is understood.
- The field at the top finds vendors, agreements, RFPs and pages; not invoices, people or tickets.
- Every team member may ask about everything, as on the pages themselves.

One requirement was extended to match what was built (C-1): the figures under each answer with their link to the list, the search field at the top, and the end-date filter on the Agreements page.

### 2026-11-21 M6 RFP done
The app now carries an RFP from the approved demand to the decision, without a separate spreadsheet. As before, the AI part runs on a stand-in that writes by simple rules, because the company's model cannot be reached from here (see "Needs your attention").

What you can do in it:

- **Record the demand.** Under RFPs, press "New RFP" and enter what is needed, the budget, the sponsor, the day the demand was approved and the day a decision is wanted. The list shows every RFP with its stage, owner and target date; running ones are shown first.
- **Always see where an RFP stands.** An RFP's page shows its six stages in a row (drafting, in review, approved, issued, evaluating, decided) with the current one marked, and one box that says the next step in a sentence, with a button to the place where it is done. The work is spread over tabs: Overview, Document, Review, Candidates, Responses, Scoring and Decision.
- **Let the AI write the first draft.** On the Document tab, "Ask the AI" gives a draft of the sections, the criteria with their weights and a numbered question list. It is only a proposal until you press "Use this draft". After that everything can be changed in one form: text, order, criteria, weights, questions. Each question belongs to one criterion, and the weights must add up to 100 before the form saves. Without the AI, "Start from the template" gives the usual sections and criteria to fill in by hand.
- **Have it reviewed.** The Review tab downloads the RFP as Word or PDF for reviewers outside the team. You record what each reviewer decided. A requested change stays open until you mark it as dealt with, and the RFP can only be marked approved with at least one approval and nothing open.
- **Keep the longlist and shortlist.** On Candidates you add vendors with the reason for each, move them between longlist, shortlist and dropped (again with a reason), and add a vendor the app does not know yet, which becomes a prospect on the Vendors page.
- **Issue it.** Each shortlisted candidate has its own two downloads: the RFP as Word and the question list as an Excel answer sheet. "Issue" records the day it went out. If no NDA is in place with that candidate, a warning appears that you must tick before going on; your name is kept with that choice. From the first issue on, the questions, criteria and weights are locked, so every candidate answers the same questions.
- **Bring the answers in.** On Responses you upload the answer sheet a candidate sent back. The app puts each answer under its question and tells you how many it matched. Rows it could not place are listed, so you can choose the question they belong to or set them aside, and every answer can also be typed or corrected by hand. Other documents a candidate sent can be attached.
- **Let the AI compare.** "Ask the AI to compare" gives, per question, a short summary of each candidate's answer and the differences, and per criterion a proposed score for each candidate with the passage of the answer it rests on. Nothing in it is a score. If an answer changes afterwards the page says the comparison is behind.
- **Score.** On Scoring every team member gives each candidate 1 to 5 on every criterion, including the demo and interview ones, with an optional comment. The AI's proposal is shown as an outline next to the criterion and becomes your score only if you accept it. The table at the top shows the written score, the demo score, the overall score and the ranking, and under each criterion the average and who gave what.
- **Decide.** On Decision you choose the winner and write the reasons. The winner becomes an active vendor; no agreement is created, and the other candidates stay as they were. After that the RFP can no longer be changed.
- **Download the decision record.** One PDF with the whole trail: the demand, the sign-offs, every candidate with the reason, the scores per person and what they add up to, and the decision.
- **See RFPs elsewhere.** Running RFPs now appear on the dashboard and in the monthly report with their stage, and a vendor's panel lists the RFPs it is or was a candidate in.

The sample data has three RFPs: one being evaluated (answers in, the AI's comparison made, some scores given, and one shortlisted candidate not yet issued and without an NDA, to try the warning), one in drafting with an AI draft waiting to be looked at, and one decided, with its decision record.

How it was checked: an independent tester ran a whole RFP from scratch through the screens, tried to break every rule both on screen and behind it, and worked out the scores, the weighted parts, the overall figures and the ranking by hand for two candidates and three scorers; the page and the decision record matched to the cent. All eleven requirements passed. An independent reviewer read all the code and found one thing that had to be fixed and ten that should be; all are fixed, each with a test. The ones that mattered most:

- **An answer could have ended up under the wrong question.** If a candidate filled in an answer sheet that was made before the question list was reordered, the app trusted the numbers and would have put answers under other questions without a word. It now also looks at the question written in each row: an answer goes under the question it was written for, or is listed for you to place.
- **An RFP could go out in a form nobody had approved.** The document could be rewritten after approval and still be issued on the old approval. Now an approved document is fixed. If you take it back to drafting and change it, the earlier approval stays visible as "approved an earlier version" but no longer counts, and a new approval is needed.
- **Typed text could be lost.** Switching to another tab and back threw away changes to the document that were not saved yet, and "Use this draft" could replace them without asking. Both are fixed: unsaved text stays while you look at another tab, and nothing replaces it without asking first.
- **The AI's "quote" could have been a single word.** A proposed score must now rest on a real passage of the candidate's answer (or the whole answer when it is only a few words), and a proposed score for a candidate that does not exist is refused.
- **The sample draft copied the internal need into the introduction**, which goes to vendors. The stand-in no longer does that, and the real model is told to reword the need for vendors and not to copy it.

After the fixes the tester went through the changed points again in the running app, eleven in all, and every one passed.

Other fixes worth knowing: an answer that a later upload replaces is now in the history with both texts; a row "that could not be matched" from an older upload can no longer be placed after a colleague uploaded a newer sheet; a decision cannot be dated before the RFP was issued; and an uploaded Excel file is measured by what it really unpacks into, so a file built to swell up cannot stop the app.

Needs your attention:

- **No real AI model has been tried, again.** No key for a real model was available in this build environment. The draft you see is put together from the template and your own words, and the comparison only repeats the opening of each answer and rewards how much was answered, not how good it is. There are seven new invented test cases for the draft and the comparison; the three that the stand-in can take pass, and the four that need real understanding (for example an answer that tells the AI to give itself a 5) wait for the company's model. Run them at work before relying on a draft or a proposed score.
- **Vendors' answers are read by the AI.** They are passed as material to read and the AI is told never to follow instructions in them, and a proposed score counts for nothing until a person accepts it. Still, this is the first place where text written by outsiders reaches the AI, so read the proposals with that in mind.
- **Candidates see the criteria and their weights** in the Word document they receive, and how much the written answers and the demo count. The budget and the sponsor are never in it. Say if weights should stay internal.
- **A decision cannot be undone and a cancelled RFP cannot be reopened.** Say if an admin should be able to.
- **The built-in template is my guess at a sensible one** (six sections, six criteria, written answers 70% and demo 30%). Give me the team's own template and I will replace it.
- **A draft is written from the need, so read it before it goes out.** The budget and the sponsor are never given to the AI. But if someone types an amount or a name into the need itself, a real model could repeat it in a section that vendors read.
- **An approved RFP has to be approved again after any change, however small.** That is the safe reading of "approved". Say if small corrections should be allowed without a new approval.
- **Several requirements were reworded slightly** to match what was built: the AI's draft is a proposal that you take over (Q-2); a requested change is closed by marking it as dealt with, and an approval stops counting when the document changes afterwards (Q-3); the weights of the two parts are locked together with the questions and criteria (Q-5); answers are matched on number and wording (Q-6); nothing changes after the decision (Q-9); and the decision record can already be downloaded before the decision, as the trail so far (Q-10).

Decided on your behalf (see `docs/open-questions.md`, Q55 to Q70):

- An approved document is fixed. It can be taken back to drafting and changed, after which it needs a new approval.
- Any vendor that is not offboarded can be a candidate, also one you already work with. Only shortlisted candidates are issued.
- An answer sheet is matched on the number in its first column as long as the question in that row is still that question, and otherwise on the exact wording of the question. Uploading again replaces the answers it matches and keeps the rest.
- The AI compares only when asked, and is asked again after more answers have come in.
- Scores are averaged per criterion, weighted within each part, and combined by the two part weights. They are shown with two decimals; candidates with the same overall score share a place. A part shows a score once every one of its criteria has been scored by someone.
- Everyone sees everyone's scores and comments, and the decision record prints them per person.
- A decision can be recorded before everything is scored; the page points it out.

### 2026-11-21 M5 Briefings, risk flags, dashboard and monthly report done
The app now opens on a real dashboard, warns about things that are heading the wrong way, prepares you for a vendor meeting and makes the monthly report for the IT management team. As before, the AI part runs on a stand-in that writes by simple rules, because the company's model cannot be reached from here (see "Needs your attention").

What you can do in it:

- **See risk flags.** The Warnings page now has a second list, Risk flags, for things that are not wrong yet. There are three kinds: a SOW that is being invoiced faster than its budget allows, a SOW about to end while milestones are still open, and a helpdesk figure that got worse three months in a row. Every flag says which figures set it off, for example how much was invoiced in how many days and on which day the budget would run out. A "Show" box narrows the page to one kind. The bell in the header counts the flags too.
- **Start from the dashboard.** The landing page shows three counts (warnings, risk flags, scorecards still to finalise), then what needs attention counted per kind, every active SOW with how much of its budget is used, spend for the last twelve months, each vendor's latest score and whether it went up or down, the scorecards due for last quarter, and open RFPs. Everything on it is a link to the page behind it.
- **Prepare a briefing for a vendor meeting.** Open a vendor, choose the new Briefings tab and press "Prepare a briefing". You get a page with the vendor's agreements and upcoming dates, spend against budget, the last three months of helpdesk figures with their trend, missed targets, open milestones, change requests waiting for a decision, and its warnings and risk flags. The AI suggests a summary and talking points. They become part of the briefing only when you press "Use this text"; you can change them, write your own, or reject them. "Download PDF" gives the briefing as a file.
- **A briefing keeps its figures.** It shows the facts of the day it was prepared and does not change afterwards. For a later meeting you prepare a new one; the vendor's tab lists them all.
- **Make the monthly management report.** The "Monthly report" button on the dashboard opens the report for last month; any of the last two years can be chosen. It shows spend against budgets, agreements ending within 90 days, vendor scores with their trend, missed helpdesk targets and open RFPs. The AI can write the summary paragraph; you use it, change it or write your own, and "Download PDF" gives one or two pages for the management team.
- **Nothing the AI wrote is printed unseen.** A summary or talking point appears in a PDF only after a person used or wrote it. If the AI cannot answer, the page says so and everything can still be typed by hand.

The sample data has one example of each kind of risk flag, a briefing for a consultancy with AI text waiting to be looked at, and September's report with a summary already taken over. October's report is untouched, to try from the start.

How it was checked: an independent tester used the running app against all four requirements and the general ones, and recalculated the figures of briefings, the dashboard and the report from the pages they come from; everything passed. An independent reviewer read all the code and found two things that had to be fixed and eight that should be; all are fixed, each with a test. The two that mattered most:

- If a colleague pressed "Ask again" while you were reading the AI's text, your "Use this text" would have taken over the new text, which nobody had read. Now the app notices, changes nothing and asks you to read the new text first.
- A report summary is saved text, while the figures under it are worked out afresh each time. An invoice keyed in later could leave the summary quoting an old amount. The page now marks such a summary "Figures changed" and the PDF says so under it, until someone has read it again and saved it.

Other fixes worth knowing: the check that stops the AI from mentioning figures of its own was made stricter in one way (a number hidden in a SOW title no longer counts as a figure) and more lenient in another (it no longer refuses "the next 90 days"); a helpdesk vendor that has been offboarded no longer raises flags; and after pressing "Use this text" with the keyboard you keep your place on the page.

Needs your attention:

- **No real AI model has been tried, again.** No key for a real model was available in this build environment. The summaries and talking points you see come from the stand-in, which only strings the facts together, so they read stiffly. There are now ten invented test cases for the monthly proposals, the report summary and the briefing; they pass against the stand-in, which proves the checks work and nothing about a real model's writing. At work, run them once against the company's model (the runbook says how) before relying on the text.
- **The AI is not allowed to mention a number the app did not give it.** If a real model rounds an amount or works out a difference by itself, its answer is thrown away and asked for once more, and after that the page says the AI could not answer. This is deliberate, but with a real model it may happen more often than you like. If it does, say so; the rule can be loosened.
- **"Heading over budget" also applies to fixed-price SOWs**, as the requirement says "a SOW". On a fixed-price SOW one large milestone invoiced early can raise the flag although nothing is wrong. The sample SOW 07 shows what that looks like. Say if fixed-price SOWs should be left out.
- **"Got worse three months in a row" is taken literally.** A figure that slipped a little three times, and still meets its target, is flagged (the sample has one: 2.3%, 2.5%, 2.7%, 4.7% against a target of 5%). Say if a flag should only appear once the target is missed.
- **Open RFPs are an empty section for now** on the dashboard and in the report. They fill once the RFP part (next) is built.
- **Three requirements were reworded slightly** to match what was built: a briefing keeps the figures of the day it was prepared, and the AI's text becomes part of it when someone uses it (B-1); the "SOW ending" flag follows the number of days you set in Settings (R-1); the summary is printed only once someone has used or written it, and the report says when the figures changed since (D-2).

Decided on your behalf (see `docs/open-questions.md`, Q41 to Q54):

- The pace of invoicing is what has been invoiced so far, spread evenly over the days since the start date. A SOW is only judged once it has run 30 days.
- "Scorecards due" are those for the quarter that has just ended, for every scored vendor in use.
- For a past month the report shows invoices up to the month's last day, against budgets, targets and agreements as they are today.
- When there is more than fits on two pages, the report's tables are shortened and each says how many rows it leaves out.
- A briefing looks 180 days ahead for dates, three months back for helpdesk figures and twelve months back for spend.
- Any team member may prepare, change and remove a briefing and write the report's summary; the history shows who did.

### 2026-11-21 M4 Scorecards and AI scoring done
The app now scores vendors. Each month the AI proposes scores for the helpdesk vendors, and each quarter a team member turns that, together with their own judgement, into a scorecard that can be sent to the vendor. Because the company's AI model cannot be reached from here, a stand-in writes the proposals by simple rules; it proves that everything around the AI works, not how good a real model's proposals will be (see "Needs your attention").

What you can do in it:

- **See the AI's proposal for a month.** Open a helpdesk vendor on Performance and choose a month that is over. Under the figures is the AI's proposal: a score from 1 to 5 for each criterion that is measured from Jira, the reason in a few sentences, the figures it was given, and the problems that came back in several tickets, each with example tickets. It is marked as written by the AI, with the date.
- **Decide about a proposal.** Accept it, change its scores, or reject it. The page then says who decided and when, and the vendor's history keeps it. Nothing the AI writes counts for anything until someone accepts it. A decision can be changed later.
- **Ask the AI yourself.** Last month's proposals are written by the app itself. For an earlier month, press "Ask the AI for a proposal". If the AI cannot answer, the page says so and everything else keeps working.
- **Start a scorecard.** On Performance there are now two views, Helpdesk and Scorecards. Press "Start a scorecard", choose a vendor and a quarter. You are its reviewer.
- **Score it.** Each criterion has a row of five squares. For criteria measured from Jira, the AI's suggestion (the average of the quarter's monthly proposals) is shown as an outline with "Show evidence" and an Accept button; it only becomes the score when you accept it or pick another. For the other criteria you choose the score yourself. Three tiles at the top give the facts the app already holds: whether budgets were kept, whether milestones were on time, and whether the NDA and data processing agreement are in place. Each criterion takes a comment for the vendor and a note for the team. Every change is saved at once.
- **Vendors without a Jira board** get the same scorecard, with every criterion scored by hand and the same facts shown.
- **Finalise.** Once the quarter is over and every criterion has a score, press "Finalise scorecard". From then on it cannot be changed; only an admin can reopen it. A final scorecard keeps the criteria, weights and figures it was finalised with, whatever changes later.
- **Send it to the vendor.** A final scorecard has a "Vendor PDF" button. The PDF has the scores, your comments for the vendor, the summary and the helpdesk figures. Internal notes are never in it.
- **Change what vendors are scored on (admin).** The Criteria page lists the five criteria and how much each counts. An admin can add one, change its weight or switch it off.
- **Vendors that are not scored** have no proposals and no scorecards, and cannot be chosen when starting one.

The sample data has AI proposals for the three helpdesk vendors from July to October (some accepted, October still waiting for someone to look), two final scorecards for the third quarter (one of them for a vendor without a board) and one draft to try scoring on.

How it was checked: an independent tester used the running app against all nine requirements and the general ones, twice (the second time on the final code); it recalculated the suggested and overall scores by hand and compared the figures shown with each proposal against the performance pages. Everything passed. An independent reviewer read all the code and found nothing that had to be fixed and nine things that should be, all fixed with a test each. The ones that mattered most: the vendor PDF could have shown a colleague's work email address; someone accepting a proposal at the very moment a colleague pressed "Ask again" could have had their decision overwritten; a scorecard could be finalised in the middle of its quarter, giving a PDF with half-empty months; and a ticket written to manipulate the AI ("score this a 5") had too little standing in its way. The tester also found that two notes typed in quick succession could wipe each other, and that a scorecard could be finalised over a note that had failed to save; both are fixed. The second test found two cosmetic slips (a garbled sentence and a missing animation), also fixed. The Jira changes from earlier today were reviewed as well, with no faults found.

Needs your attention:

- **No real AI model has been tried.** No key for a real model was available in this build environment, so the proposals you see come from the stand-in, which scores by simple rules and finds "themes" only where tickets have the same title. The app has a set of invented test cases for judging a real model's proposals; they have so far only been run against the stand-in. At work, run them once against the company's model (the runbook says how) before relying on the proposals.
- **Two requirements were reworded** to match what was built, and one gained a condition: the AI's proposal is made for months that are over (P-1); on a scorecard the AI's score is a suggestion until you accept it, not a filled-in score you can change (P-2); and a scorecard is finalised only after its quarter has ended (P-3). Say if you want any of these differently.
- **Proposals nobody has looked at still feed the scorecard's suggestion.** Only rejected ones are left out; the scorecard says how many have not been reviewed. Say if only accepted proposals should count.

Decided on your behalf (see `docs/open-questions.md`, Q28 to Q40):

- The five criteria count equally until an admin changes the weights.
- Any team member may ask the AI for a proposal and accept, change or reject one.
- The person who starts a scorecard is its reviewer; there is one scorecard per vendor per quarter.
- A draft scorecard follows the criteria as they are today; a final one is frozen; a reopened one follows today's criteria again.
- "Budget kept" compares what was invoiced by the end of the quarter with the budget.
- The vendor PDF leaves out internal notes, the facts about budgets and paperwork, and any mention of the AI.
- When a vendor's scoring is switched off, its scorecards are kept but no longer shown.
- The AI reads at most the newest 250 tickets of a month; a theme needs at least two tickets.
- A draft can be removed; a final scorecard cannot.
- Letters outside Western European alphabets print as a question mark in the PDF for now.

### 2026-11-21 Jira connection checked against Atlassian's documentation
The check left open at the end of M3 is done: this build environment can open Atlassian's developer documentation, and the Jira connection was compared with it point by point.

**Confirmed as written:** the call that searches for tickets and how its pages follow each other; the call that lists Jira's fields (where the app finds the response-time and satisfaction measurements by name); the three calls about boards; the shape of a response-time (SLA) result, with finished rounds and a running one; how Jira writes dates and times; and the way of signing in with an email address and an API token.

**Changed, because the documentation showed a better or safer way:**

- **Ticket history is now fetched for a thousand tickets at a time**, where it used to be one request per ticket. Linking a large board for the first time now takes a handful of requests, so the worry about a first sync taking minutes is largely gone.
- **Tickets are asked for in two plain questions** ("changed lately" and "not yet resolved") where it used to be one combined question. There are reports of Jira returning too few tickets for that kind of combined question (not confirmed in the documentation itself); two plain questions cannot be affected.
- **When Jira asks the app to slow down**, the app now waits at least as long as Jira says (it could wait less before), a little longer at each try, and gives up until the next sync when Jira says its hourly allowance is used up.
- **A reopened ticket's rounds are put in time order by the app itself**, since the documentation does not promise the order they arrive in.
- **If two measurements carry the same name**, the app takes the one that belongs to the service desk.

The stand-in Jira used for building and testing was changed in the same way, so it still answers exactly as the documentation says the real one does.

**Still only visible at work** (open question W8), because Atlassian does not document them: what the four measurements are called on the company's Jira, how a satisfaction rating is written on a ticket, how status and label changes are named in a ticket's history, and whether the company's kind of API token works on the Jira address itself. One Test link and one Sync now on a real board answer all four. Until then the connection stays marked unproven; a wrong name leaves a figure empty, never wrong.

### 2026-11-21 M3 Performance from Jira done
The app now shows how each helpdesk vendor is performing, from its Jira tickets. Because the company's Jira cannot be reached from here, it runs on a stand-in Jira with invented boards and tickets; the real connection is written but has never run (see "Needs your attention").

What you can do in it:

- **Link a vendor to its Jira board (admin).** On Performance, press Link a board, choose the vendor and its board, and say whether a ticket's support level shows in its status or in a label, and which statuses or labels mean level 1, 2 and 3. Test link checks the board without saving, lists the statuses and labels it found and points out a misspelt one. Saving fetches the tickets at once.
- **Sync.** Tickets are fetched every hour by the app itself, and whenever anyone presses Sync now. Each board shows when it was last fetched and how many tickets changed. If a fetch fails, the page says why in plain words and the tickets and figures already there stay as they were.
- **A vendor's month.** Open a vendor from Performance (or from the new Performance tab in its panel on Vendors) to see five figures for the chosen month: first response, first-line closure, SLA breaches, backlog age and satisfaction, each with small bars for the last twelve months and a table of the same twelve months below.
- **The tickets behind a number.** Every number is a link. "5 late" opens exactly those five tickets, which can be searched and sorted.
- **Targets.** Any team member presses Set targets and types the targets from the contract. Every month then says met or missed, and a missed target says a service credit may apply. No amount is calculated.
- **Overview.** Performance lists every scored vendor that has a board with this month's figures against target, worst first, sortable by any column, for any month of the last two years. Scored vendors without a board are named underneath.

The sample data has three linked helpdesk vendors (one where escalation shows as a status, one as a label), one free board to try linking yourself, and a "flaky demo board" whose every second fetch fails, so you can see what a failure looks like.

How it was checked: an independent tester used the running app against all five requirements and the general ones, and recalculated the figures by hand and by script for 36 vendor-months from the ticket lists; all passed. An independent reviewer read the code and found two real defects, both fixed with a test each: a ticket deleted or moved in Jira would have stayed "open" here for ever and made the backlog look older every day, and a month before a board's first ticket showed a backlog of "0 days, target met". About fifteen smaller points from both were fixed as well, such as the Back button after choosing a month and the overview fitting a smaller window.

Needs your attention:

- **The Jira documentation could not be opened from here.** (Since done: see the entry above.) The Jira connection was written from general knowledge and proven only against the stand-in, built so that a wrong name gives empty figures, never wrong ones.
- **Three requirements were reworded slightly** to match what was built: any member may press Sync now and the schedule is hourly (J-2); whether a figure must be at least or at most its target follows from the metric (J-4); the overview covers scored vendors that have a board and names the others (J-5).

Decided on your behalf (see `docs/open-questions.md`, Q19 to Q27):

- Tickets are fetched every hour while the app runs.
- A ticket that never had a level 2 or level 3 status or label counts as solved by the first line.
- The backlog target is the age of the oldest open ticket; the SLA target is the share of tickets resolved late.
- Today's targets are applied to every month shown; earlier targets are in the vendor's history but not re-applied.
- Figures are rounded to one decimal and that rounded figure is judged, so 94.96% meets a 95% target.
- First response counts tickets for which Jira has an outcome; one still waiting within its time is left out until it has one.
- The overview opens on the running month, marked "so far".
- A vendor with scoring switched off cannot be linked to a board and shows no performance figures.

### 2026-11-21 M2 SOW delivery and money done
The app now follows what each SOW delivers and what it costs. What you can do in it:

- **Milestones.** On a SOW's page, add milestones with a due date, mark them delivered or cancel them. A late one says how many days late. On a fixed-price SOW a milestone can carry a payment amount, and the amounts can never add up to more than the budget.
- **Change requests.** Record an extension or a budget change as proposed, then approve or reject it. Approving moves the SOW's budget and end date, and the page keeps showing where the SOW started and where it is now.
- **Rate cards and consultants.** Each vendor has a Money tab with its day rates per role, each with a start date, so a new rate does not erase the old one. On a SOW you name the consultants and their role, and the page shows each one's current day rate.
- **Invoices.** Key in an invoice against a SOW (optionally against a milestone) or a subscription. The currency follows the agreement, and the same invoice number cannot be entered twice for one vendor.
- **Budget.** Every SOW shows budget, invoiced, remaining and the percentage used, as a meter. From 80% it is marked close to budget, and past 100% over budget; both also appear under the bell and on the warnings page.
- **Spend.** The Money section shows spend per month and per vendor for any period, in euros, in pounds, and together in euros. Both the overview and the invoice list download as a file for Excel.
- **Settings (admin).** One page sets the pound to euro rate and the warning thresholds: days before a notice deadline, days before a SOW ends, and the budget percentage. Changing the rate changes converted totals only, never an invoice.

The sample data now includes milestones, an approved extension, consultants, rates and invoices, so every screen has something to show.

How it was checked: an independent tester used the running app against all seven requirements and the general ones (keyboard use, empty screens, failed saves, dates, speed); all passed, and the figures on the spend page were added up by hand against the invoices. An independent reviewer read the code and found one real defect: after a change request was approved, the budget could still be typed over directly, which made "started at, now at" untrue. That is fixed, along with about fifteen smaller points from both, such as a confirmation before removing an invoice and clearer wording in the history.

Decided on your behalf (see `docs/open-questions.md`, Q12 to Q18):

- An invoice cannot be negative or dated in the future. A credit is handled by correcting or removing the invoice.
- Any team member may approve a change request; the history shows who did.
- Once a change request is approved, the SOW's budget and end date change only through further change requests.
- A milestone's amount is optional, and a milestone invoiced above its amount is marked, not refused.
- A consultant's rate may be in pounds on a euro SOW.
- The pound to euro rate starts at 1.17 until you set the real one in Settings.

Three requirements were reworded slightly to match what was built: milestone amounts are optional (M-1), the spend overview itself can also be exported (M-6), and the Renewals page and on-screen explanations follow the thresholds you set (M-7).

### 2026-11-21 M1 Vendors and agreements done
The app now holds your vendors and contracts. What you can do in it:

- **Vendors.** Add and edit vendors with their type, owner, contacts and status. The list can be searched, filtered and sorted, and a vendor opens in a panel beside the list. Each vendor shows whether its NDA and data processing agreement are in place, missing or expired. A vendor with a running agreement cannot be offboarded by accident.
- **Agreements.** Add an MSA, SOW, subscription, NDA or data processing agreement; the form only asks for what that kind needs. A SOW can sit under an MSA. Each agreement has a status (draft, in negotiation, out for signature, active, ended) and its own page with its documents and full history.
- **Documents.** Attach PDF, Word and Excel files to an agreement, download them and remove them.
- **Renewals.** Every subscription shows its notice deadline. The Renewals page lists what is overdue or coming up within 30, 60, 90 or 180 days. You record the decision (renew, renegotiate, terminate), and renewing can move the renewal date on to the next term.
- **Warnings.** The bell in the header counts what needs attention: notice deadlines, SOWs about to end or past their end date, and missing or expired paperwork. Each warning links to its record, and the dashboard lists the first few.
- **Export and import.** The agreement list downloads as a file that opens in Excel. An admin can fill an Excel template with vendors and agreements, see what each row would do before anything is saved, and import the rows that are fine. Importing the same file twice adds nothing.

The app comes with nine invented sample vendors so every screen and every kind of warning has something to show. They are clearly marked "(invented)" and are not loaded when the app runs at work.

How it was checked: as before, an independent tester used the running app against every requirement and an independent reviewer read all the code. They confirmed seven real defects and about thirty smaller points. The ones that mattered most: a vendor could be offboarded and then still have an agreement made active; the Excel import could misread an amount that came from a formula by a factor of a thousand; and the import preview could promise rows that the import then refused. All were fixed, each with a test that would catch it again, and re-checked.

Decided on your behalf (see `docs/open-questions.md`, Q6 to Q11):

- Renewing a subscription moves its renewal date and leaves the original start date.
- A SOW still marked active after its end date gets a red warning.
- An amount typed as 1.234 is read as one thousand two hundred and thirty-four; the form shows how it read the amount before you save.
- If two people edit the same record at the same moment, the last save wins.
- Amounts always show cents.

### 2026-11-21 M0 Foundation done
The app now exists and runs. What you can do in it:

- Open it and be recognised straight away, with your name and role shown in the bottom left corner. Anyone opening it for the first time is added as a member; the first admin is whoever is named in the settings.
- As an admin, see everyone who has signed in, make someone an admin or a member, and switch someone's access off and on. The app will not let the last admin be removed.
- See the history of every change on a person's panel, and browse the full audit log, filtered by person, type of record and date.
- Run the system check, which tests the five connections (sign-in, database, file storage, Jira, AI model) and says in plain words what is wrong and what to do when one fails.
- Switch between light and dark, and move around all the sections. Vendors, Agreements, Money, Performance, RFPs and Ask each explain what will live there.

How it was checked: an independent tester used the running app against every requirement, and an independent reviewer read all the code. Between them they raised two serious problems and about twenty smaller ones; all were fixed and re-tested. The two serious ones were that a wrong "first admin" setting at deployment would have locked you out for good, and that a dropped database connection could have stopped the app.

Decided on your behalf (see `docs/open-questions.md`):

- Times are shown in Amsterdam time (Q5).
- The app does not use Databricks' AppKit framework, only its small database helper, so that it can run and be tested outside Databricks. Recorded in decision 0001.
- While building, the database is built into the app, so nothing has to be installed to run it.
- Forms, file upload and PDF export moved from this milestone to M1, where the first screens need them.

What has not been proven: everything that only exists at work. The real sign-in, Lakebase, the document volume, Jira and the AI models are written from documentation and have never run. The system check page and `docs/runbook.md` are there to make that first deployment quick.

### 2026-11-21 PRD written, plan reworked
After three rounds of questions the brief became a full product requirements document.
The product is now a vendor and contract management tool for the VS Finance team, built
around MSAs and SOWs, with helpdesk scoring from Jira, AI-proposed scorecards, briefings,
a monthly management report and a guided RFP process. The requirements, data model,
architecture and plan were rewritten to match. The plan now has ten milestones.

### 2026-11-21 Project set up
First version of the brief, requirements, plan and agent workflow. No application code yet.

## Follow-ups
- M13: an amount typed as text with three decimals ("12.345") is read as twelve thousand, as in the forms, where a point before three digits separates thousands. A number cell with three decimals is refused.
- M13: a negative day rate in the import says it is not an amount rather than that it must be above zero.
- M13: an invoice or contact whose agreement or vendor row has a problem says the agreement or vendor is not there, rather than that its row has a problem.
- M13: the import's table of rows does not slide in as lists do elsewhere, and its summary gives totals only, not per sheet.
- M13: a hand-over records the owner change by name; a change of owner in a form records it as "owner changed". Both are in the history, worded differently.
- M13: the hand-over and the import read and write some records of other parts of the app directly rather than through those parts; no rule is skipped today.
- M13: a hand-over and someone activating one of the same agreements at the very same moment could clash and ask to try again. Very unlikely with five people.
- M12: when the currency list replaced the pound rate, the saved pound rate counted as "set by an admin" whenever the settings had been saved, also when only the warning days were changed. Nothing like that exists at work yet, so it was left; check the pound's rate there once.
- M12: briefings made before the currency list say they were converted at the pound rate of the day of the change, not of the day they were made. Their euro figures are right. Nothing like that exists at work yet.
- M12: the rate field takes at most 99,999.9999 of a currency for one euro, so the Lebanese pound and the Iranian rial cannot be added at today's market rates.
- M12: the agreement list sorts by value in euros but shows each value in its own currency, as every record's page does.
- M12: a contract amount written next to a year ("in 2027 EUR 9,000") can be read as the year; such a value is then left out, never taken.
- M12: the file downloads give amounts in euros but do not say which rates were starting rates.
- The check of the RFP list's search (Q-11) failed once during a full run on 22 Nov 2026, while the machine was busy, and passed in every run since, alone and in full. Probably the search box and the "All" button changing the address at nearly the same moment. To be watched.
- Pressing Tab past the last button of a dialog moves on to the browser itself before coming back. That is how the browser's own dialogs work and it predates M10, but the design guide says focus stays inside; to be looked at.
- At a very narrow window (a phone) the vendor form is cramped and the vendor list scrolls sideways. The app is made for a laptop screen.
- M11: the settings page has two sections called "History" (the settings' own and the contact roles'); they could be named apart.
- M11: a table pasted with merged cells shows its merged rows short in the editor until it is saved; once saved, every cell sits in its own column.
- Final pass before M9: Ask took "Which agreements need notice before year end?" too loosely and listed agreements renewing later; the look-up and its link were shown, so the figures could be checked.
- Final pass before M9: an invoice sent to the server with another currency than its agreement's is booked in the agreement's currency without a word. The screen has no currency field, so only a direct call can do this.
- Final pass before M9: there is no "skip to content" link; the first Tab goes into the menu. The automated accessibility check passes.
- Final pass before M9: an answer sheet made for one candidate is accepted when uploaded for another.
- M11: the review's code reviewer suggested further hardening that was left for later: Word's own cover-page boxes tied to document properties (W12), and comments marked as resolved in Word, which are read as open remarks.
- A VAT number typed into Excel as a plain number loses any zeros at its start before the app sees it; type it with its country letters.
- The check that job titles became roles runs on the built-in database only, not on the server database the tests can also use.
- A record with more than 200 changes shows the newest 200, and says so; an admin sees all of them on the Audit log page.
- Contract reading compares, after values were taken over, the document with the agreement as it has become; which values were taken is in the history, not in the panel.
- The time shown on an AI proposal follows the app's clock, which is pinned when "today" is pinned for testing, so in a test set-up it can differ from the time in the history. Not so in normal use.
- Contract reading does not propose the reference, automatic renewal, the renewal term, fixed price or time and materials, or the MSA a SOW sits under.
- A large PDF (hundreds of pages) is read while the person who attached it waits, and the app is busy for everyone during those seconds. Fine for ordinary contracts; to be moved to the background if large files turn out to be common.
- Ask has no limit on how often someone can ask. Each question is two calls to the AI model; to be watched once the cost per call at work is known.
- Ask finds document passages by the words they share with the question, looking through every document each time. Fine for a few hundred documents; a proper text index is the next step if there are many more.
- When a question has a condition the lists cannot apply (for example "invoices over 50,000"), the stand-in says it cannot answer. Whether the real model says so as plainly has to be seen at work.
- A question typed as one unbroken word of several hundred characters wraps onto many lines; harmless.
- One older check (searching the tickets behind a helpdesk figure) failed once while the machine was busy with a slower run of the checks, and passed every time since. To be watched.
- The first page load shows one "not found" message in the browser's own error console, not on screen; where it comes from was not traced.
- Two people changing the same RFP document at the same moment: the last save wins. The one who was typing is told that someone else saved, but only once the page has fetched the newer version.
- Two quick saves on an RFP page can come back in the wrong order and briefly show the older state; a reload shows the right one.
- An AI draft or comparison nobody looked at stays "not reviewed yet" after the RFP is decided.
- The app does not check in the database itself that a question, answer or score belongs to the same RFP as its candidate; the code checks it everywhere and tests prove it.
- A download's plain file name (for old software) drops accented letters; the full name is sent as well and is what current browsers use.
- A demo criterion can be saved while the demo part counts for 0%; the page says so before the RFP can go to review.
- The date boxes in the RFP dialogs follow the browser's own format, like everywhere else in the app.
- The monthly report page has two small accessibility findings (empty table headers) that an automated check reports; they predate this milestone.
- Whether the sliding and bouncing on the RFP screens matches the design guide was not checked by the tester, who works from still pictures.
- Numbers written out in words ("sixty thousand") are not caught by the check on the AI's text; only digits are. A person reads the text before it counts.
- For an earlier month the report lists agreements as they are today: one that has since been renewed or ended is not shown as "ending" in that month's report.
- The bell and the Warnings page are worked out afresh on every page, including the helpdesk figures of four months. Fine with the sample data (pages load in under a second); to be measured at work with real ticket numbers, and kept for a few minutes if slow.
- Two people typing a report summary or a briefing at the same moment: the last save wins, and text being typed is replaced if a colleague's save arrives first.
- Reloading the page while typing a summary or talking points loses what was not saved, without a warning.
- Clearing the summary after taking over the AI's text leaves it marked "accepted with changes".
- "Scorecards due" also lists a vendor added after the quarter ended.
- Asking the AI again after its summary was taken over no longer shows which AI text the saved summary came from; the history still does.
- A very long vendor name can run into the page number at the foot of a PDF.
- The greeting on the dashboard follows the real clock even when the date is pinned for a demo.
- The app has no icon in the browser tab.
- The bell's label still says "warnings" although it counts risk flags as well.
- The AI's proposals have only been written by the stand-in. Run the invented test cases against the company's model at work before relying on them (runbook, "After the first deployment: AI proposals").
- The AI's written reason is not checked sentence by sentence against the figures. The figures the app worked out are always shown right under it, and a score that flatly contradicts them is refused, but a reason could still misquote a number.
- "Ask again" can be pressed as often as anyone likes, and each press is one call to the AI model. Fine for five people; add a limit if the model turns out to be costly.
- The app writing last month's proposals by itself was checked by running that step directly, not by watching the timer fire after hours of running.
- A scorecard's history and its "Finalised by" line show email addresses where the rest of the page shows names. The same is true of history everywhere in the app.
- In the vendor PDF each weight is rounded by itself, so three equal weights print as 33%, 33% and 33%.
- Letters outside Western European alphabets print as a question mark in the PDF (open question Q39).
- A scorecard an admin reopens follows today's criteria and figures again; what it showed while final is only in its history.
- A ticket deleted in Jira in the instant between two steps of a sync is kept, without its history, until the next sync an hour later removes it.
- Linking a board fetches its tickets while the admin waits. Since the documentation check this takes a handful of requests even for a large board (history is asked for a thousand tickets at a time, not ticket by ticket), so it should be seconds, not minutes. To be measured once at work.
- Jira connection, still to be seen at work (open question W8): the names of the four measurements on the company's Jira, how a satisfaction rating is written on a ticket, the names "status" and "labels" in a ticket's history, and whether the company's kind of API token works on the Jira address itself. One Test link and one Sync now on a real board answer all four.
- A board whose sync is switched off keeps its tickets beyond 24 months, since the clean-up runs with the sync.
- A reopened ticket is judged on its final resolution; an earlier late resolution of the same ticket is not counted.
- The median first response time leaves out tickets still waiting for an answer, so it reads slightly low while answers are slipping.
- Two people saving the same vendor's targets at the same moment: the last save wins for every metric.
- If Jira gains or renames a measurement, the app notices after a restart.
- Whether Databricks keeps the app running at night decides whether the hourly sync runs then (open question W9).
- A second branch from another session (`claude/adoring-curie-k6ewvw`) holds a wider spreadsheet import (contacts, rate cards, past invoices). It was started from M0, before M1 and M2, and is not part of the app yet. Decide whether to bring it in; it will need rework first.
- Search and sorting do not ignore accents: searching "beta" does not find "Béta", and "École" sorts after "Z".
- The app allows two agreements with the same vendor, kind and title; the import treats that combination as "already there".
- The date boxes in forms follow the browser's own date format, which may be month-first on some machines. Everything the app itself writes is day month year.
- A renewal term shorter than a year that starts on the 31st drifts to the 28th after passing through February.
- A person's name is taken at first sign-in and not refreshed if it later changes in the company directory.
- Removing a contact or a document happens at once; only invoices, consultants and rates ask "Really remove?" first.
- A cancelled milestone keeps its amount if the SOW is later switched to time and materials.
- The rate dialog shows one problem at a time when both the role and the rate are wrong.
- One older check (two admins demoting each other at the same instant) failed once in seven runs on the real database while the machine was busy, and passed every other time. To be watched; if it recurs it needs a proper look.
- Two people changing the same SOW at the very same moment has been reasoned through and guarded, but not tried with two real people.
- Deploy the app once at work as a rehearsal (open question Q3). With M1 done there is now something real to try there.
- Two automated checks failed once each while the whole set ran, and passed on their own and in the next full run: choosing "Ask: …" with the keyboard in the top search field, and searching the RFP list by title. Both look like timing when the computer is busy; to be looked into if they fail again. (Found during M8a.)
- A workbook for the Excel import or an answer sheet is checked against 25 MB before sending, but the app refuses workbooks over 10 MB. A file between the two is sent and then refused in plain words. (Found during M8a.)
- Dropping or picking several documents refreshes the page once at the end; if one file of many is refused by the app, the others are still attached.
