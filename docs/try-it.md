# Try the app on your own computer

This starts the app with invented sample data. Nothing is installed permanently except
the two tools in step 1, nothing leaves your computer, and everything you enter is gone
when you stop it. Do not enter real company data: this copy runs outside the company.

It takes about ten minutes the first time and one minute after that.

## 1. Install Node.js (once)

Download the "LTS" installer from https://nodejs.org and click through it. Version 20 or newer.

## 2. Download the project (once, and again whenever you want the newest version)

No extra tool is needed for this:

1. In your browser, signed in to GitHub, open https://github.com/chrissim16/vendormanagement/tree/claude/jolly-curie-d4v8z0
2. Press the green **Code** button, then **Download ZIP**.
3. Open the downloaded ZIP so it unpacks into a folder (on a Mac: double-click it in Downloads). The folder is called `vendormanagement-claude-jolly-curie-d4v8z0`. Move it somewhere you will find it again, such as Documents.

## 3. Open a terminal in that folder and install (once per download)

- **Mac**: press Cmd+Space, type `Terminal`, press Enter. In the window type `cd ` (the two letters and a space), then drag the project folder from Finder into the window, and press Enter.
- **Windows**: open the folder in File Explorer, click the address bar, type `powershell` and press Enter.

Then paste this and press Enter:

```
npm install
```

It takes a few minutes and prints a lot; it is done when the cursor comes back. Warnings in yellow are fine.

## 4. Start it

```
npm run try
```

Wait for the line `vendorapp is running`, then open **http://localhost:5173** in your browser.

What you should see: the dashboard with a greeting and a red number on the bell. At the
bottom left, "Viewing as" lets you look at the app as the admin or as a team member.

## 5. Stop it

Click the terminal window and press Ctrl+C. Close the window.

## Next time

Open a terminal in the folder as in step 3 and type `npm run try`.

To get what was built since, download the ZIP again (step 2), and in the new folder run `npm install` and then `npm run try`. The old folder can go in the bin.

## Things to try

- **Ask**: press `/` and type "Which SOWs end this quarter?", or "What does the contract with Bluefinch say about liability?"
- **Contract reading**: Agreements, open "Reporting suite", press "Read with AI" on the order form.
- **RFPs**: open "Expense management tool" and walk through its tabs.
- **Performance**: open a vendor and click a number to see the tickets behind it.

The AI in this copy is a simple stand-in that only understands plain wordings; the real one comes with the company's model.

## If something goes wrong

| What you see | What to do |
|---|---|
| `node` or `npm` "is not recognized" or "command not found" | Node.js is not installed, or the terminal was open while you installed it. Close the terminal, open a new one, try again. |
| "This needs Node.js 20 or newer" | Install the current LTS version from nodejs.org. |
| GitHub shows "404" for the project page | You are not signed in to GitHub in that browser, or signed in as someone else. The project is private. |
| `npm install` says "no such file or directory, open ... package.json" | The terminal is not in the project folder. Repeat the `cd` step: type `cd `, drag the folder in, press Enter. |
| "Port 3000 is already in use" or "5173 is in use" | The app is already running in another terminal window. Close that window, or press Ctrl+C in it. |
| The page is empty or says it cannot connect | The app has not finished starting. Wait for `vendorapp is running`, then reload the page. |
