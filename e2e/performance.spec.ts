import { expect, test, type APIRequestContext } from "@playwright/test";
import { formatMetric, formatTarget, metricInfo, metricKeys, type PerformanceOverview, type VendorPerformance } from "../shared/performance";
import { ADMIN, asAdminApi, expectAccessible, MEMBER, newVendor, signInAs } from "./helpers";

const BASE = "http://127.0.0.1:4173";
const asAdmin = { "x-dev-user": ADMIN, cookie: "" };
const getJson = async <T>(request: APIRequestContext, path: string) => (await (await request.get(`${BASE}/api${path}`, { headers: asAdmin })).json()) as T;
const sampleVendor = async (request: APIRequestContext, name: string) => (await getJson<PerformanceOverview>(request, "/performance")).rows.find((r) => r.vendorName === name)!;
const n = (x: number) => x.toLocaleString("en-GB");

test.describe("J-1 board link", () => {
  test("J-1 an admin links a vendor to its Jira board, says how escalation shows, tests the link and saves it", async ({ page, context, request }) => {
    const v = await newVendor(request, "Helpdesk");
    await signInAs(context, ADMIN);
    await page.goto("/performance");
    await page.getByRole("button", { name: "Link a board" }).click();
    const dialog = page.getByRole("dialog", { name: "Link a Jira board" });
    await dialog.getByLabel("Vendor").selectOption({ label: v.name });
    // A board another vendor already has cannot be chosen.
    await expect(dialog.getByLabel("Jira board").locator("option", { hasText: "BLU · Bluefinch Systems service desk (invented) · linked to Bluefinch Systems" })).toBeDisabled();
    await dialog.getByLabel("Jira board").selectOption("SED");
    await dialog.getByLabel("A ticket's support level shows in").selectOption("label");

    // X-3: saving without level values is refused, and what was chosen stays.
    await dialog.getByRole("button", { name: "Link board" }).click();
    await expect(dialog.getByText("Give at least one label that means level 2 or level 3.", { exact: false })).toBeVisible();
    await expect(dialog.getByLabel("Jira board")).toHaveValue("SED");
    await expect(dialog.getByLabel("Vendor")).toHaveValue(v.id);

    // A misspelt label is pointed out by the test, with the labels the board does have.
    await dialog.getByLabel("Labels that mean level 2, the second line").fill("teir-2");
    await dialog.getByLabel("Labels that mean level 3, the third line").fill("tier-3");
    await dialog.getByRole("button", { name: "Test link" }).click();
    await expect(dialog.getByText("Working, with remarks")).toBeVisible();
    await expect(dialog.getByText("Connected to Sedgewater Cloud support (invented).")).toBeVisible();
    await expect(dialog.getByText("Not seen on this board's recent tickets: teir-2.", { exact: false })).toBeVisible();
    await expect(dialog.getByText(/Labels on this board: .*tier-2/)).toBeVisible();

    await dialog.getByLabel("Labels that mean level 2, the second line").fill("tier-2");
    await dialog.getByRole("button", { name: "Test link" }).click();
    await expect(dialog.getByText("Working", { exact: true })).toBeVisible();
    await expectAccessible(page);

    await dialog.getByRole("button", { name: "Link board" }).click();
    await expect(page.getByText(new RegExp(`Linked ${v.name} to SED: [\\d,]+ tickets fetched`))).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // The vendor is now on the overview, and its page shows how the board is read.
    await page.getByRole("button", { name: `Open ${v.name}` }).click();
    await expect(page.getByRole("heading", { name: v.name })).toBeVisible();
    await expect(page.getByText("Jira board SED · Sedgewater Cloud support (invented)")).toBeVisible();
    await expect(page.getByText("A label on the ticket")).toBeVisible();
    await expect(page.getByText("tier-2", { exact: true })).toBeVisible();
    await expect(page.getByText("Jira board set to SED · Sedgewater Cloud support (invented)", { exact: false })).toBeVisible();

    // Changing which labels count is done from the vendor's page.
    await page.getByRole("button", { name: "Edit board link" }).click();
    const edit = page.getByRole("dialog", { name: `Jira board of ${v.name}` });
    await expect(edit.getByLabel("Labels that mean level 2, the second line")).toHaveValue("tier-2");
    await edit.getByLabel("Labels that mean level 2, the second line").fill("tier-2, second-line");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`Saved the Jira board of ${v.name}`)).toBeVisible();
    await expect(page.getByText("second-line", { exact: true })).toBeVisible();
  });

  test("J-1 a member cannot link or change a board", async ({ page, context, request }) => {
    const blu = await sampleVendor(request, "Bluefinch Systems");
    await signInAs(context, MEMBER);
    await page.goto("/performance");
    await expect(page.getByRole("button", { name: "Open Bluefinch Systems" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link a board" })).toHaveCount(0);
    await page.goto(`/performance/${blu.vendorId}`);
    await expect(page.getByRole("button", { name: "Set targets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit board link" })).toHaveCount(0);
    const refused = await request.put(`${BASE}/api/admin/vendors/${blu.vendorId}/jira-link`, {
      headers: { "x-dev-user": MEMBER, cookie: "" },
      data: { projectKey: "BLU", escalationMethod: "status", l2Values: ["x"] },
    });
    expect(refused.status()).toBe(403);
  });
});

test.describe("J-2 sync", () => {
  test("J-2 the page shows when tickets were last fetched and how many were updated, and Sync now fetches again", async ({ page, context, request }) => {
    const blu = await sampleVendor(request, "Bluefinch Systems");
    await signInAs(context, MEMBER);
    await page.goto("/performance");
    await expect(page.getByText("Tickets are fetched from Jira every hour.")).toBeVisible();
    const perBoard = page.getByRole("list", { name: "Jira sync per board" });
    await expect(perBoard.getByRole("listitem").filter({ hasText: "Bluefinch Systems" })).toContainText(/board BLU · last fetched 21 Nov 2026, 13:00, [\d,]+ tickets? updated/);

    await page.goto(`/performance/${blu.vendorId}`);
    await expect(page.getByText(new RegExp(`Last fetched from Jira 21 Nov 2026, 13:00 · [\\d,]+ tickets? updated · ${n(blu.link.tickets)} tickets held`))).toBeVisible();
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText(/Fetched from Jira: [\d,]+ tickets? updated/)).toBeVisible();
    await expect(page.getByText(new RegExp(`${n(blu.link.tickets)} tickets held`))).toBeVisible();
  });

  test("J-2 a failed sync says why in plain language and leaves the tickets and figures as they were", async ({ page, context, request }) => {
    const v = await newVendor(request, "Flaky");
    const link = {
      projectKey: "FLK",
      escalationMethod: "status",
      l1Values: ["Waiting for support"],
      l2Values: ["Escalated to second line"],
      l3Values: ["With vendor engineering"],
    };
    // The stand-in's flaky board answers the first fetch and fails the second.
    const linked = await (await asAdminApi(request, "put", `/admin/vendors/${v.id}/jira-link`, link)).json();
    expect(linked.sync.ok).toBe(true);
    const held = linked.link.tickets as number;
    expect(held).toBeGreaterThan(20);
    const before = await getJson<VendorPerformance>(request, `/performance/vendors/${v.id}?month=2026-10`);

    await signInAs(context, MEMBER);
    await page.goto(`/performance/${v.id}?month=2026-10`);
    await expect(page.getByText(`${n(held)} tickets held`)).toBeVisible();
    await page.getByRole("button", { name: "Sync now" }).click();
    const problem = page.getByRole("status", { name: "Jira sync problem" });
    await expect(problem).toContainText("Jira could not be read. The service reported a problem on its side. The tickets fetched earlier are unchanged.");
    await expect(problem).toContainText("last fetched successfully 21 Nov 2026, 13:00");
    // Nothing technical leaks through.
    await expect(problem).not.toContainText(/503|Error|undefined/);
    const after = await getJson<VendorPerformance>(request, `/performance/vendors/${v.id}?month=2026-10`);
    expect(after.link!.tickets).toBe(held);
    expect(after.months).toEqual(before.months);
    // The figures are still on the page.
    const firstLine = page.getByRole("list", { name: "Metrics for October 2026" }).getByRole("listitem", { name: "First-line closure" });
    await expect(firstLine).toContainText(formatMetric("first_line", before.months.at(-1)!.cells.first_line.valueTenths));
    await expectAccessible(page);

    // The overview names the board that failed.
    await page.goto("/performance");
    await expect(page.getByRole("group", { name: `Sync of ${v.name}` })).toContainText("Jira could not be read.");

    // The next sync works and the message goes.
    await page.goto(`/performance/${v.id}?month=2026-10`);
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText(/Fetched from Jira: [\d,]+ tickets? updated/)).toBeVisible();
    await expect(page.getByText("Last sync failed")).toHaveCount(0);

    // An admin switches the sync off: the tickets stay, and Sync now is no longer offered.
    await asAdminApi(request, "put", `/admin/vendors/${v.id}/jira-link`, { ...link, active: false });
    await page.reload();
    await expect(page.getByText("Sync switched off")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
    await expect(firstLine).toBeVisible();
  });
});

test.describe("J-3 monthly metrics", () => {
  test("J-3 a vendor's month shows the five metrics with a twelve-month trend, and each number opens the tickets behind it", async ({ page, context, request }) => {
    const blu = await sampleVendor(request, "Bluefinch Systems");
    const p = await getJson<VendorPerformance>(request, `/performance/vendors/${blu.vendorId}?month=2026-10`);
    const october = p.months.at(-1)!;
    const c = october.counts;
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${blu.vendorId}`);
    await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-11");
    await page.getByLabel("Month", { exact: true }).selectOption("2026-10");
    await expect(page).toHaveURL(/month=2026-10/);

    const metrics = page.getByRole("list", { name: "Metrics for October 2026" });
    await expect(metrics.getByRole("listitem")).toHaveCount(5);
    for (const k of metricKeys) {
      const row = metrics.getByRole("listitem", { name: metricInfo[k].label });
      await expect(row).toContainText(formatMetric(k, october.cells[k].valueTenths));
      await expect(row).toContainText(`target ${formatTarget(k, october.cells[k].targetTenths!)}`);
    }
    const fr = metrics.getByRole("listitem", { name: "First response" });
    await expect(fr).toContainText(`${n(c.frMet)} answered in time, ${n(c.frMeasured - c.frMet)} late, of ${n(c.frMeasured)} tickets created.`);
    await expect(metrics.getByRole("listitem", { name: "First-line closure" })).toContainText(
      `${n(c.firstLine)} solved by the first line, ${n(c.resolved - c.firstLine)} escalated, of ${n(c.resolved)} tickets resolved.`,
    );
    await expect(metrics.getByRole("listitem", { name: "SLA breaches" })).toContainText(`${n(c.breached)} resolved late, of ${n(c.resolved)} tickets resolved.`);
    await expect(metrics.getByRole("listitem", { name: "Backlog age" })).toContainText(`${n(c.backlog)} tickets open`);
    await expect(metrics.getByRole("listitem", { name: "Satisfaction" })).toContainText(`From ${n(c.ratings)} ratings.`);

    // Twelve months, newest first, the same figures as the bars.
    const trend = page.getByRole("table", { name: "Twelve months of metrics" });
    await expect(trend.locator("tbody tr")).toHaveCount(12);
    await expect(trend.locator("tbody tr").first()).toContainText("Oct 2026");
    await expect(trend.locator("tbody tr").last()).toContainText("Nov 2025");
    const may = p.months.find((m) => m.month === "2026-05")!;
    await expect(trend.locator("tbody tr").filter({ hasText: "May 2026" })).toContainText(formatMetric("first_response", may.cells.first_response.valueTenths));
    await expectAccessible(page);

    // The number of late answers opens exactly those tickets.
    await fr.getByRole("link", { name: `${n(c.frMeasured - c.frMet)} late` }).click();
    await expect(page.getByRole("heading", { name: "Tickets answered late, or still waiting past the agreed time" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(`${n(c.frMeasured - c.frMet)} tickets`);
    const table = page.getByRole("table", { name: "Tickets answered late, or still waiting past the agreed time" });
    await expect(table.locator("tbody tr")).toHaveCount(c.frMeasured - c.frMet);
    for (const row of await table.locator("tbody tr").all()) {
      await expect(row).toContainText(/BLU-\d+/);
      await expect(row).toContainText("Late");
      // X-4: created in October 2026, written day month year.
      await expect(row).toContainText(/\d{1,2} (Sep|Oct|Nov) 2026/);
    }
    await expectAccessible(page);

    // Back to the vendor, same month; the headline figure opens the tickets it was measured on.
    await page.getByRole("link", { name: "Bluefinch Systems" }).click();
    await expect(page).toHaveURL(/month=2026-10/);
    await page.getByRole("link", { name: /^Satisfaction: .* Open the tickets behind it$/ }).click();
    await expect(page.getByRole("status")).toHaveText(`${n(c.ratings)} tickets`);
    await expect(page.getByRole("heading", { name: "Tickets rated by the person who asked" })).toBeVisible();

    // A list longer than a page can be paged, searched and sorted.
    await page.goto(`/performance/${blu.vendorId}/tickets?set=resolved&month=2026-10`);
    await expect(page.getByRole("status")).toHaveText(`${n(c.resolved)} tickets`);
    await expect(page.getByText(`Page 1 of ${Math.ceil(c.resolved / 25)}`)).toBeVisible();
    await page.getByLabel("Search these tickets").fill("ledger");
    await expect(page.getByRole("status")).not.toHaveText(`${n(c.resolved)} tickets`);
    for (const row of await page.getByRole("table").locator("tbody tr").all()) await expect(row).toContainText(/ledger/i);
    await page.getByLabel("Search these tickets").fill("no such ticket anywhere");
    await expect(page.getByText("No tickets match")).toBeVisible();
  });

  test("J-3 the vendor's panel shows this month's figures and leads to the full page", async ({ page, context, request }) => {
    const mos = await sampleVendor(request, "Mossgate IT");
    await signInAs(context, MEMBER);
    await page.goto(`/vendors?open=${mos.vendorId}`);
    const panel = page.getByRole("region", { name: "Mossgate IT" });
    await panel.getByRole("tab", { name: "Performance" }).click();
    await expect(panel.getByRole("heading", { name: "November 2026 so far" })).toBeVisible();
    for (const k of metricKeys) await expect(panel.getByText(metricInfo[k].label, { exact: true })).toBeVisible();
    await expect(panel.getByText(formatMetric("first_line", mos.metrics.cells.first_line.valueTenths), { exact: true })).toBeVisible();
    await expectAccessible(page);
    await panel.getByRole("link", { name: "Open performance" }).click();
    await expect(page.getByRole("heading", { name: "Mossgate IT" })).toBeVisible();
    await expect(page.getByText("Jira board MOS", { exact: false })).toBeVisible();
  });
});

test.describe("J-4 targets", () => {
  test("J-4 a member sets a target per metric; the month shows met or missed, and a missed target says a service credit may apply", async ({ page, context, request }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    const before = (await getJson<VendorPerformance>(request, `/performance/vendors/${tar.vendorId}?month=2026-10`)).targets;
    const october = (await getJson<VendorPerformance>(request, `/performance/vendors/${tar.vendorId}?month=2026-10`)).months.at(-1)!;
    const rating = october.cells.csat.valueTenths!;
    expect(before.csat).toBeNull();
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${tar.vendorId}?month=2026-10`);
    const csat = page.getByRole("list", { name: "Metrics for October 2026" }).getByRole("listitem", { name: "Satisfaction" });
    await expect(csat).toContainText("No target");

    await page.getByRole("button", { name: "Set targets" }).click();
    const dialog = page.getByRole("dialog", { name: "Targets for Tarnwick Software" });
    await expect(dialog.getByLabel("First response: % answered in time, at least")).toHaveValue("90");
    // X-3: a target that cannot be read is refused, and what was typed stays.
    await dialog.getByLabel("Satisfaction: average rating out of 5, at least").fill("very happy");
    await dialog.getByLabel("Backlog age: days the oldest open ticket may be, at most").fill("14");
    await dialog.getByRole("button", { name: "Save targets" }).click();
    await expect(dialog.getByText("Enter a number up to 5, with at most one decimal, such as 4.0. Leave empty for no target.")).toBeVisible();
    await expect(dialog.getByLabel("Satisfaction: average rating out of 5, at least")).toHaveValue("very happy");
    await expect(dialog.getByLabel("Backlog age: days the oldest open ticket may be, at most")).toHaveValue("14");
    await expectAccessible(page);

    // A target just above what was achieved is missed; one at what was achieved is met.
    const above = ((rating + 1) / 10).toFixed(1);
    await dialog.getByLabel("Satisfaction: average rating out of 5, at least").fill(above.replace(".", ","));
    await dialog.getByLabel("Backlog age: days the oldest open ticket may be, at most").fill("");
    await dialog.getByRole("button", { name: "Save targets" }).click();
    await expect(page.getByText("Targets saved")).toBeVisible();
    await expect(csat).toContainText(`Missed · target ${above} or more`);
    await expect(csat).toContainText("Target missed, a service credit may apply.");
    await expect(page.getByText(`target for satisfaction set to ${above} or more`, { exact: false })).toBeVisible();
    const row = page.getByRole("table", { name: "Twelve months of metrics" }).locator("tbody tr").filter({ hasText: "Oct 2026" });
    await expect(row).toContainText(/\d missed/);

    await page.getByRole("button", { name: "Set targets" }).click();
    await dialog.getByLabel("Satisfaction: average rating out of 5, at least").fill((rating / 10).toFixed(1));
    await dialog.getByRole("button", { name: "Save targets" }).click();
    await expect(csat).toContainText(`Met · target ${(rating / 10).toFixed(1)} or more`);
    await expect(csat).not.toContainText("service credit");

    // Emptying the box removes the target again.
    await page.getByRole("button", { name: "Set targets" }).click();
    await dialog.getByLabel("Satisfaction: average rating out of 5, at least").fill("");
    await dialog.getByRole("button", { name: "Save targets" }).click();
    await expect(csat).toContainText("No target");
    expect((await getJson<VendorPerformance>(request, `/performance/vendors/${tar.vendorId}`)).targets).toEqual(before);
  });
});

test.describe("J-5 performance overview", () => {
  test("J-5 every scored vendor with a board is listed with this month's figures against target, sortable, with missed targets marked", async ({ page, context, request }) => {
    const o = await getJson<PerformanceOverview>(request, "/performance");
    await signInAs(context, MEMBER);
    await page.goto("/performance");
    await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
    const table = page.getByRole("table", { name: "Performance in November 2026" });
    for (const name of ["Bluefinch Systems", "Mossgate IT", "Tarnwick Software"]) {
      const r = o.rows.find((x) => x.vendorName === name)!;
      const row = table.locator("tbody tr").filter({ hasText: name });
      for (const k of metricKeys) {
        const cell = r.metrics.cells[k];
        await expect(row).toContainText(formatMetric(k, cell.valueTenths));
        if (cell.verdict !== "none") await expect(row).toContainText(`${cell.verdict === "missed" ? "Missed" : "Met"} · target ${formatMetric(k, cell.targetTenths)}`);
      }
      await expect(row).toContainText(r.metrics.missed ? `${r.metrics.missed} missed` : "Targets met");
    }
    // Bluefinch has slipped on first response: marked as missed, in words as well as colour.
    const blu = table.locator("tbody tr").filter({ hasText: "Bluefinch Systems" });
    await expect(blu).toContainText("Missed · target 95%");
    // Tarnwick has no satisfaction target: a figure without a verdict.
    await expect(table.locator("tbody tr").filter({ hasText: "Tarnwick Software" })).toContainText("No target");

    // Worst first by default; then by name; then by a metric.
    const names = async () => (await table.locator("tbody tr td:first-child").allInnerTexts()).map((s) => s.trim());
    const worstFirst = [...o.rows].map((r) => r.vendorName);
    expect((await names()).filter((x) => worstFirst.includes(x))).toEqual(worstFirst);
    await table.getByRole("button", { name: "Vendor" }).click();
    await expect(page).toHaveURL(/sort=vendor/);
    await expect.poll(names).toEqual([...(await names())].sort((a, b) => a.localeCompare(b)));
    await table.getByRole("button", { name: "First-line closure" }).click();
    await expect(page).toHaveURL(/sort=first_line/);
    const byMetric = (await getJson<PerformanceOverview>(request, "/performance?sort=first_line&dir=asc")).rows.map((r) => r.vendorName);
    await expect.poll(names).toEqual(byMetric);

    // Another month, held in the address.
    await page.getByLabel("Month", { exact: true }).selectOption("2026-09");
    await expect(page).toHaveURL(/month=2026-09/);
    await expect(page.getByRole("table", { name: "Performance in September 2026" })).toBeVisible();
    const september = (await getJson<PerformanceOverview>(request, "/performance?month=2026-09")).rows.find((r) => r.vendorName === "Bluefinch Systems")!;
    await expect(page.getByRole("table").locator("tbody tr").filter({ hasText: "Bluefinch Systems" })).toContainText(
      formatMetric("first_response", september.metrics.cells.first_response.valueTenths),
    );

    // Scored vendors without a board are named, so nobody wonders where they are.
    await expect(page.getByText(/Scored vendors without a Jira board: .*Quillon Consulting/)).toBeVisible();
    await expectAccessible(page);
  });

  test("J-5 X-1 the overview and a vendor's figures can be reached and opened with the keyboard alone", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/performance?sort=vendor&dir=asc");
    const open = page.getByRole("button", { name: "Open Bluefinch Systems" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Bluefinch Systems" })).toBeVisible();
    await page.getByRole("button", { name: "Set targets" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Targets for Bluefinch Systems" });
    await expect(dialog.getByLabel("First response: % answered in time, at least")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set targets" })).toBeFocused();
    const figure = page.getByRole("link", { name: /^First response: .* Open the tickets behind it$/ });
    await figure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Tickets created, with a first-response result" })).toBeVisible();
  });
});

test.describe("performance, throughout", () => {
  test("X-2 a vendor without a board, and a figure with no tickets behind it, say what belongs there", async ({ page, context, request }) => {
    const v = await newVendor(request, "Boardless");
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${v.id}`);
    await expect(page.getByRole("heading", { name: "No Jira board linked" })).toBeVisible();
    await expect(page.getByText("Linking a board is done by an admin.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link a board" })).toHaveCount(0);
    await expectAccessible(page);

    await signInAs(context, ADMIN);
    await page.reload();
    await expect(page.getByRole("button", { name: "Link a board" }).first()).toBeVisible();

    const tar = await sampleVendor(request, "Tarnwick Software");
    // Before the invented helpdesk started there is nothing behind any figure.
    await page.goto(`/performance/${tar.vendorId}/tickets?set=breached&month=2025-01`);
    await expect(page.getByRole("heading", { name: "No tickets behind this figure" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Tarnwick Software" })).toBeVisible();

    // An address that names no figure, or no vendor, is a page that does not exist.
    await page.goto(`/performance/${tar.vendorId}/tickets?set=everything`);
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    await page.goto("/performance/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
  });

  test("X-5 the performance pages load within two seconds", async ({ page, context, request }) => {
    const blu = await sampleVendor(request, "Bluefinch Systems");
    await signInAs(context, MEMBER);
    for (const [path, heading] of [
      ["/performance", "Performance"],
      [`/performance/${blu.vendorId}`, "Bluefinch Systems"],
      [`/performance/${blu.vendorId}/tickets?set=resolved&month=2026-10`, "Tickets resolved"],
    ] as const) {
      const start = Date.now();
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole("table").first()).toBeVisible();
      expect(Date.now() - start, path).toBeLessThan(2000);
    }
  });
});
