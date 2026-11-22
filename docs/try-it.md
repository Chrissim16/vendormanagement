# Try the app on your own computer

This starts the app with invented sample data. Nothing is installed permanently except
the two tools in step 1, nothing leaves your computer, and everything you enter is gone
when you stop it. Do not enter real company data: this copy runs outside the company.

It takes about ten minutes the first time and one minute after that.

## 1. Install two tools (once)

- **Node.js**, version 20 or newer: download the "LTS" installer from https://nodejs.org and click through it.
- **Git**: on a Mac it is usually there already (the Mac offers to install it the first time you use it). On Windows, download it from https://git-scm.com and click through the installer with the suggested settings.

## 2. Open a terminal

- **Mac**: press Cmd+Space, type `Terminal`, press Enter.
- **Windows**: press the Windows key, type `PowerShell`, press Enter.

A window with a blinking cursor opens. You paste each command below into it and press Enter.

## 3. Get the project (once)

```
git clone https://github.com/chrissim16/vendormanagement.git
cd vendormanagement
git checkout claude/jolly-curie-d4v8z0
npm install
```

The first command may ask you to sign in to GitHub in your browser, because the project
is private. `npm install` takes a few minutes and prints a lot; it is done when the cursor
comes back. Warnings in yellow are fine.

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

Open a terminal and type:

```
cd vendormanagement
git pull
npm install
npm run try
```

`git pull` fetches what was built since. If you only want to start it again as it was, `cd vendormanagement` and `npm run try` are enough.

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
| `git clone` says "Repository not found" | You are not signed in to GitHub in the terminal. Run the command again and sign in when the browser opens. |
| "Port 3000 is already in use" or "5173 is in use" | The app is already running in another terminal window. Close that window, or press Ctrl+C in it. |
| The page is empty or says it cannot connect | The app has not finished starting. Wait for `vendorapp is running`, then reload the page. |
