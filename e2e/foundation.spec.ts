import { expect, test } from "@playwright/test";
import { ADMIN, expectAccessible, MEMBER, newAgreement, newPerson, newVendor, setPerson, signInAs } from "./helpers";

// Every test brings its own data, so any one of them can run alone: `npx playwright test -g "F-3"`.

test.describe("F-1 sign-in", () => {
  test("F-1 the header shows the signed-in person and their role", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/");
    await expect(page.getByTestId("me-name")).toHaveText("Alex Admin");
    await expect(page.getByTestId("me-role")).toHaveText("Admin");
    await signInAs(context, MEMBER);
    await page.reload();
    await expect(page.getByTestId("me-name")).toHaveText("Mira Okafor");
    await expect(page.getByTestId("me-role")).toHaveText("Member");
  });

  test("F-1 a first-time visitor becomes a member", async ({ page, context }) => {
    const email = `first-${Date.now()}@example.test`;
    await signInAs(context, email);
    await page.goto("/");
    await expect(page.getByTestId("me-name")).toHaveText(email);
    await expect(page.getByTestId("me-role")).toHaveText("Member");
  });

  test("F-1 a deactivated user sees a no access page and nothing else", async ({ page, context }) => {
    await signInAs(context, "former@example.test");
    await page.goto("/admin/people");
    await expect(page.getByRole("heading", { name: "You no longer have access" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expectAccessible(page);
    // Locally the stand-in menu stays available, so this is not a dead end while trying roles out.
    await page.getByLabel("Viewing as (local only)").selectOption(MEMBER);
    await expect(page.getByTestId("me-name")).toHaveText("Mira Okafor");
  });
});

test.describe("F-2 admin", () => {
  test("F-2 a member sees no admin pages and is refused by the server", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
    await page.goto("/admin/people");
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    for (const path of ["/api/admin/users", "/api/admin/audit"]) expect((await page.request.get(path)).status()).toBe(403);
    expect((await page.request.post("/api/admin/system-check")).status()).toBe(403);
  });

  test("F-2 an admin can change a role and switch access off, and F-3 the record shows its history", async ({ page, context, request }) => {
    const person = await newPerson(request, "role");
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?q=${encodeURIComponent(person.email)}`);
    await page.getByRole("button", { name: `Open ${person.email}` }).click();
    const panel = page.getByRole("region", { name: person.email });
    await expect(panel.getByText("Added: role set to member")).toBeVisible();

    await panel.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(page.getByText(`Saved changes for ${person.email}`)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Admin", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("Changed: role from member to admin")).toBeVisible();
    await expect(panel.getByText(ADMIN).first()).toBeVisible();

    await panel.getByRole("button", { name: "Member" }).click();
    await expect(panel.getByText("Changed: role from admin to member")).toBeVisible();
    await panel.getByRole("button", { name: "Switched off" }).click();
    await expect(panel.getByText("Changed: access from yes to no")).toBeVisible();

    await signInAs(context, person.email);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "You no longer have access" })).toBeVisible();
  });

  test("F-2 the last active admin cannot be demoted or deactivated", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/people?q=admin%40example.test");
    await page.getByRole("button", { name: "Open Alex Admin" }).click();
    const panel = page.getByRole("region", { name: "Alex Admin" });
    await panel.getByRole("button", { name: "Member" }).click();
    await expect(panel.getByRole("alert")).toContainText("This is the last admin");
    await expect(panel.getByRole("button", { name: "Admin", exact: true })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Switched off" }).click();
    await expect(panel.getByRole("alert")).toContainText("This is the last admin");
    await expect(page.getByTestId("me-role")).toHaveText("Admin");
  });
});

test.describe("F-6 handover when someone leaves", () => {
  test("F-6 switching off someone who owns records hands them over first, all to one person or per record", async ({ page, context, request }) => {
    const leaver = await newPerson(request, "leaver");
    const other = await newPerson(request, "leaver2");
    const vendor = await newVendor(request, "Handover", { ownerUserId: leaver.id });
    const agreement = await newAgreement(request, { id: vendor.id, ownerUserId: leaver.id }, { kind: "msa", title: "Handover MSA" });
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?q=${encodeURIComponent(leaver.email)}`);
    await page.getByRole("button", { name: `Open ${leaver.email}` }).click();
    const panel = page.getByRole("region", { name: leaver.email });
    await panel.getByRole("button", { name: "Switched off" }).click();

    const dialog = page.getByRole("dialog", { name: `Hand over before switching off ${leaver.email}` });
    await expect(dialog).toContainText(`${leaver.email} owns 1 vendor and 1 agreement.`);
    await expect(dialog.getByRole("list", { name: "Vendors" })).toContainText(vendor.name);
    await expect(dialog.getByRole("list", { name: "Agreements" })).toContainText(`${vendor.name} · Handover MSA`);
    await expectAccessible(page);
    // Nothing chosen: refused in place, nothing changes.
    await dialog.getByRole("button", { name: "Hand over and switch off" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose who takes everything over.");

    // Per record: one to Mira, the other to a second person.
    await dialog.getByRole("button", { name: "A person per record" }).click();
    await dialog.getByLabel(`New owner of ${vendor.name}`, { exact: true }).selectOption({ label: "Mira Okafor" });
    await dialog.getByRole("button", { name: "Hand over and switch off" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose a new owner for the record still without one.");
    await dialog.getByLabel(`New owner of ${vendor.name} · Handover MSA`).selectOption({ label: other.email });
    await dialog.getByRole("button", { name: "Hand over and switch off" }).click();
    await expect(page.getByText(`Handed over and switched off ${leaver.email}`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Switched off" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("records handed over set to 1 vendor and 1 agreement")).toBeVisible();

    await page.goto(`/agreements/${agreement.id}`);
    await expect(page.getByText(`owner from ${leaver.email} to ${other.email}`)).toBeVisible();
    await page.goto(`/vendors?open=${vendor.id}`);
    await expect(page.getByRole("region", { name: vendor.name })).toContainText("Mira Okafor");
  });

  test("F-6 all to one person in one go", async ({ page, context, request }) => {
    const leaver = await newPerson(request, "leaver-all");
    const vendor = await newVendor(request, "Handover all", { ownerUserId: leaver.id });
    await newAgreement(request, { id: vendor.id, ownerUserId: leaver.id }, { kind: "nda", title: "Handover NDA" });
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?q=${encodeURIComponent(leaver.email)}`);
    await page.getByRole("button", { name: `Open ${leaver.email}` }).click();
    await page.getByRole("region", { name: leaver.email }).getByRole("button", { name: "Switched off" }).click();
    const dialog = page.getByRole("dialog", { name: `Hand over before switching off ${leaver.email}` });
    await dialog.getByLabel("New owner of everything").selectOption({ label: "Sanne de Wit" });
    await dialog.getByRole("button", { name: "Hand over and switch off" }).click();
    await expect(page.getByText(`Handed over and switched off ${leaver.email}`)).toBeVisible();
    const owned = await (await request.get(`http://127.0.0.1:4173/api/admin/users/${leaver.id}/owned`, { headers: { "x-dev-user": ADMIN, cookie: "" } })).json();
    expect(owned.records).toEqual([]);
  });
});

test.describe("F-3 audit trail", () => {
  test("F-3 admins can browse the full log and filter by person, record type and date", async ({ page, context, request }) => {
    const person = await newPerson(request, "audit");
    await setPerson(request, person.id, { role: "admin" });
    await setPerson(request, person.id, { role: "member" });
    await signInAs(context, ADMIN);
    await page.goto("/admin/audit");
    const table = page.getByRole("table", { name: "Audit log" });
    await expect(
      table
        .getByRole("row")
        .filter({ hasText: `Changed user ${person.email}` })
        .first(),
    ).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: `Added user ${person.email}` })).toBeVisible();

    // By person: only the entry this person made themselves, their own first visit.
    await page.getByLabel("Person").fill(person.email);
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("role set to member");
    await page.reload();
    await expect(page.getByLabel("Person")).toHaveValue(person.email);
    await expect(table.getByRole("row")).toHaveCount(2);

    // By record type.
    await page.getByLabel("Person").fill("");
    await page.getByLabel("Record type").selectOption("user");
    await expect(page).toHaveURL(/entityType=user/);
    await expect(
      table
        .getByRole("row")
        .filter({ hasText: `Changed user ${person.email}` })
        .first(),
    ).toBeVisible();

    // By date: today includes the entries, a day long ago shows none.
    const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date()));
    await page.getByLabel("From").fill(today);
    await page.getByLabel("To", { exact: true }).fill(today);
    await expect(table.getByRole("row").filter({ hasText: `Added user ${person.email}` })).toBeVisible();
    await page.getByLabel("From").fill("");
    await page.getByLabel("To", { exact: true }).fill("2000-01-01");
    await expect(page.getByRole("heading", { name: "No entries match these filters" })).toBeVisible();
  });
});

test.describe("F-4 system check", () => {
  test("F-4 each connection is tested and reported in plain language", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/system-check");
    await expect(page.getByRole("heading", { name: "Everything is connected" })).toBeVisible();
    for (const [key, label] of [
      ["identity", "Sign-in"],
      ["database", "Database"],
      ["storage", "File storage"],
      ["jira", "Jira"],
      ["ai", "AI model"],
    ] as const) {
      const row = page.getByTestId(`check-${key}`);
      await expect(row.getByRole("heading", { name: label })).toBeVisible();
      await expect(row.getByText("Working", { exact: true })).toBeVisible();
      await expect(row.getByText("Stand-in", { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("check-identity")).toContainText(`You are ${ADMIN}`);
    await page.getByRole("button", { name: "Run again" }).click();
    await expect(page.getByRole("heading", { name: "Everything is connected" })).toBeVisible();
  });

  test("F-4 a failing connection says what is wrong and what to do", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.route("**/api/admin/system-check", async (route) => {
      const res = await route.fetch();
      const items = await res.json();
      const jira = items.find((i: { key: string }) => i.key === "jira");
      Object.assign(jira, { ok: false, detail: "Jira refused the sign-in.", fix: "Check the Jira service account's email and API token in the app settings.", cases: [] });
      await route.fulfill({ response: res, json: items });
    });
    await page.goto("/admin/system-check");
    await expect(page.getByRole("heading", { name: "1 of 5 connections need attention" })).toBeVisible();
    const row = page.getByTestId("check-jira");
    await expect(row.getByText("Not working")).toBeVisible();
    await expect(row).toContainText("Jira refused the sign-in.");
    await expect(row).toContainText("What to do: Check the Jira service account");
  });
});

test.describe("throughout", () => {
  test("X-1 a person can be opened, changed and closed with the keyboard alone", async ({ page, context, request }) => {
    const person = await newPerson(request, "keys");
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?q=${encodeURIComponent(person.email)}`);
    const row = page.getByRole("button", { name: `Open ${person.email}` });
    await expect(row).toBeVisible();

    // Tab from the top of the page until the row is reached; no mouse and no scripted focus.
    for (let i = 0; i < 40 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("region", { name: person.email });
    await expect(panel.getByRole("heading", { name: person.email })).toBeFocused();
    await page.keyboard.press("Tab"); // Close
    await page.keyboard.press("Tab"); // Member
    await page.keyboard.press("Tab"); // Admin
    const admin = panel.getByRole("button", { name: "Admin", exact: true });
    await expect(admin).toBeFocused();
    await page.keyboard.press("Space");
    await expect(admin).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("Changed: role from member to admin")).toBeVisible();
    // Focus stays where it was, so the next key continues from here.
    await expect(admin).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test("X-1 pages pass automated accessibility checks in light and dark", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    for (const mode of ["light", "dark"]) {
      await page.addInitScript((m) => localStorage.setItem("mode", m), mode);
      for (const path of ["/", "/performance", "/admin/people", "/admin/audit", "/admin/system-check"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path === "/admin/people") await page.getByRole("button", { name: "Open Mira Okafor" }).click();
        if (path.endsWith("system-check")) await expect(page.getByTestId("check-ai")).toBeVisible();
        await expectAccessible(page);
      }
    }
  });

  test("list pattern: filters, sorting and the open record survive a reload, and Back closes the record", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/");
    await page.getByRole("link", { name: "People" }).click();
    await page.getByLabel("Access", { exact: true }).selectOption("true");
    await page.getByRole("button", { name: "Role", exact: true }).click();
    await page.getByRole("button", { name: "Open Mira Okafor" }).click();
    await expect(page).toHaveURL(/active=true/);
    await expect(page).toHaveURL(/sort=role/);
    await page.reload();
    await expect(page.getByLabel("Access", { exact: true })).toHaveValue("true");
    await expect(page.getByRole("region", { name: "Mira Okafor" })).toBeVisible();
    await expect(page.getByRole("table", { name: "People" })).not.toContainText("Former Colleague");

    await page.evaluate(() => history.back());
    await expect(page.getByRole("region", { name: "Mira Okafor" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Access", { exact: true })).toHaveValue("true");
  });

  test("list pattern: a shared link opens a record even when a filter hides it from the list", async ({ page, context, request }) => {
    const person = await newPerson(request, "link");
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?q=alex&open=${person.id}`);
    await expect(page.getByRole("region", { name: person.email })).toBeVisible();
    await expect(page.getByRole("table", { name: "People" })).not.toContainText(person.email);
  });

  test("X-3 a failed save says what went wrong and leaves things as they were", async ({ page, context, request }) => {
    const person = await newPerson(request, "fail");
    await signInAs(context, ADMIN);
    await page.goto(`/admin/people?open=${person.id}`);
    const panel = page.getByRole("region", { name: person.email });
    await page.route("**/api/admin/users/*", (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
    await panel.getByRole("button", { name: "Admin", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("could not be reached");
    await expect(panel.getByRole("button", { name: "Member" })).toHaveAttribute("aria-pressed", "true");
  });

  test("X-2 every section in the sidebar is built: none says it is still to come", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    // Ask was the last one, built in M7.
    await page.goto("/");
    for (const section of ["Vendors", "Agreements", "Money", "Performance", "RFPs", "Ask"]) {
      await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: section, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("This part of the app has not been built yet.")).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
  });

  test("the theme switch changes to dark and is remembered", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-mode", "dark");
    await page.getByRole("button", { name: "Switch between light and dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  });

  test("no request leaves the app for another site", async ({ page, context }) => {
    const outside: string[] = [];
    page.on("request", (r) => !r.url().startsWith("http://127.0.0.1:4173") && !r.url().startsWith("data:") && outside.push(r.url()));
    await signInAs(context, ADMIN);
    await page.goto("/admin/people");
    await expect(page.getByRole("table", { name: "People" })).toBeVisible();
    expect(outside).toEqual([]);
  });
});

test.describe("F-3 a long history stays out of the way", () => {
  test("F-3 a page without tabs shows the newest five changes, with Show all for the rest", async ({ page, context, request }) => {
    const v = await newVendor(request, "History");
    const a = await newAgreement(request, v, { kind: "msa", title: "Much changed MSA" });
    for (let i = 1; i <= 6; i++) {
      const res = await request.patch(`http://127.0.0.1:4173/api/agreements/${a.id}`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { notes: `Note ${i}` } });
      expect(res.ok()).toBe(true);
    }
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${a.id}`);
    const history = page.getByRole("list", { name: "History" });
    await expect(history.getByRole("listitem")).toHaveCount(5);
    await expect(history.getByRole("listitem").first()).toContainText("Note 6");
    await page.getByRole("button", { name: "Show all 7" }).click();
    await expect(history.getByRole("listitem")).toHaveCount(7);
    await expect(history.getByRole("listitem").last()).toContainText("Added");
    await page.getByRole("button", { name: "Show the newest 5" }).click();
    await expect(history.getByRole("listitem")).toHaveCount(5);
    await expectAccessible(page);
  });
});
