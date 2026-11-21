import { expect, test } from "@playwright/test";
import { ADMIN, expectAccessible, MEMBER, signInAs } from "./helpers";

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
    await signInAs(context, "newcomer@example.test");
    await page.goto("/");
    await expect(page.getByTestId("me-name")).toHaveText("newcomer@example.test");
    await expect(page.getByTestId("me-role")).toHaveText("Member");
  });

  test("F-1 a deactivated user sees a no access page and nothing else", async ({ page, context }) => {
    await signInAs(context, "former@example.test");
    await page.goto("/admin/people");
    await expect(page.getByRole("heading", { name: "You no longer have access" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expectAccessible(page);
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
    for (const path of ["/api/admin/users", "/api/admin/audit", "/api/admin/system-check"]) {
      expect((await page.request.get(path)).status()).toBe(403);
    }
  });

  test("F-2 an admin can change a role and switch access off, and F-3 the record shows its history", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/people");
    await page.getByRole("button", { name: "Open Sanne de Wit" }).click();
    const panel = page.getByRole("region", { name: "Sanne de Wit" });
    await panel.getByRole("radio", { name: "Admin" }).click();
    await expect(page.getByText("Saved changes for Sanne de Wit")).toBeVisible();
    await expect(panel.getByRole("radio", { name: "Admin" })).toBeChecked();
    await expect(panel.getByText("Changed: role from member to admin")).toBeVisible();
    await expect(panel.getByText(ADMIN).first()).toBeVisible();

    await panel.getByRole("radio", { name: "Member" }).click();
    await expect(panel.getByText("Changed: role from admin to member")).toBeVisible();
    await panel.getByRole("radio", { name: "Switched off" }).click();
    await expect(panel.getByText("Changed: access from yes to no")).toBeVisible();

    await signInAs(context, "sanne@example.test");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "You no longer have access" })).toBeVisible();
  });

  test("F-2 the last active admin cannot be demoted or deactivated", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/people");
    await page.getByRole("button", { name: "Open Alex Admin" }).click();
    const panel = page.getByRole("region", { name: "Alex Admin" });
    await panel.getByRole("radio", { name: "Member" }).click();
    await expect(panel.getByRole("alert")).toContainText("This is the last admin");
    await expect(panel.getByRole("radio", { name: "Admin" })).toBeChecked();
    await panel.getByRole("radio", { name: "Switched off" }).click();
    await expect(panel.getByRole("alert")).toContainText("This is the last admin");
    await expect(page.getByTestId("me-role")).toHaveText("Admin");
  });
});

test.describe("F-3 audit trail", () => {
  test("F-3 admins can browse the full log and filter by person, record type and date", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/audit");
    const table = page.getByRole("table", { name: "Audit log" });
    await expect(table.getByRole("row").filter({ hasText: "Changed user sanne@example.test" }).first()).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Added user newcomer@example.test" })).toBeVisible();

    await page.getByLabel("Person").fill("newcomer");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("role set to member");
    await page.reload();
    await expect(page.getByLabel("Person")).toHaveValue("newcomer");
    await expect(table.getByRole("row")).toHaveCount(2);

    await page.getByLabel("Person").fill("");
    await page.getByLabel("Record type").selectOption("user");
    await expect(table.getByRole("row").nth(1)).toBeVisible();
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
  test("X-1 the people list can be worked with the keyboard alone", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/people");
    await page.getByRole("button", { name: "Open Jonas Brandt" }).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Jonas Brandt" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close panel" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
  });

  test("X-1 pages pass automated accessibility checks in light and dark", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    for (const mode of ["light", "dark"]) {
      await page.addInitScript((m) => localStorage.setItem("mode", m), mode);
      for (const path of ["/", "/vendors", "/admin/people?open=none", "/admin/audit", "/admin/system-check"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path.startsWith("/admin/people")) await page.getByRole("button", { name: "Open Mira Okafor" }).click();
        if (path.endsWith("system-check")) await expect(page.getByTestId("check-ai")).toBeVisible();
        await expectAccessible(page);
      }
    }
  });

  test("V-1 pattern: filters, sorting and the open record survive a reload", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    await page.goto("/admin/people");
    await page.getByLabel("Access").selectOption("true");
    await page.getByRole("button", { name: "Role" }).click();
    await page.getByRole("button", { name: "Open Mira Okafor" }).click();
    await expect(page).toHaveURL(/active=true/);
    await expect(page).toHaveURL(/sort=role/);
    await page.reload();
    await expect(page.getByLabel("Access")).toHaveValue("true");
    await expect(page.getByRole("region", { name: "Mira Okafor" })).toBeVisible();
    await expect(page.getByRole("table", { name: "People" })).not.toContainText("Former Colleague");
  });

  test("X-2 empty sections say what belongs there", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/vendors");
    await expect(page.getByRole("heading", { name: "No vendors yet" })).toBeVisible();
    await page.getByRole("link", { name: "Agreements" }).click();
    await expect(page.getByRole("heading", { name: "No agreements yet" })).toBeVisible();
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
});
