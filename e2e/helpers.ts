import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export const ADMIN = "admin@example.test";
export const MEMBER = "mira@example.test";
const BASE = "http://127.0.0.1:4173";

/** Look at the app as this person (the local stand-in for company sign-in). */
export async function signInAs(context: BrowserContext, email: string) {
  await context.clearCookies();
  await context.addCookies([{ name: "dev_user", value: email, url: BASE }]);
}

/**
 * A brand-new person with a unique address, so each test brings its own data and can run
 * alone or in any order. Returns their email and id.
 */
export async function newPerson(request: APIRequestContext, label: string) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await request.get(`${BASE}/api/me`, { headers: { "x-dev-user": email, cookie: "" } });
  expect(res.ok()).toBe(true);
  return { email, id: (await res.json()).id as string };
}

/** Changes a person as the admin, straight through the API, to set a test up. */
export async function setPerson(request: APIRequestContext, id: string, change: { role?: "admin" | "member"; active?: boolean }) {
  const res = await request.patch(`${BASE}/api/admin/users/${id}`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: change });
  expect(res.ok()).toBe(true);
}

/** X-1: no accessibility violations that an automated check can find. */
export async function expectAccessible(page: Page) {
  // Let entrance animations finish so colours are measured at rest.
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

/** Parts of a page that repeat (one per answer, say) must not be landmarks with the same name: a screen reader could not tell them apart. */
export async function expectDistinctLandmarks(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(["landmark-unique"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

export const TODAY = "2026-11-21";
const asAdmin = { "x-dev-user": ADMIN, cookie: "" };
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** A vendor of the test's own, owned by the admin, with paperwork not required unless asked for. */
export async function newVendor(request: APIRequestContext, label: string, fields: Record<string, unknown> = {}) {
  const me = await (await request.get(`${BASE}/api/me`, { headers: asAdmin })).json();
  const res = await request.post(`${BASE}/api/vendors`, {
    headers: asAdmin,
    data: { name: unique(label), type: "software", ownerUserId: me.id, ndaRequired: false, dpaRequired: false, ...fields },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; name: string; ownerUserId: string };
}

export async function newAgreement(request: APIRequestContext, vendor: { id: string; ownerUserId: string }, fields: Record<string, unknown>) {
  const res = await request.post(`${BASE}/api/agreements`, {
    headers: asAdmin,
    data: { vendorId: vendor.id, ownerUserId: vendor.ownerUserId, title: unique("Agreement"), ...fields },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; title: string };
}

export const warningCount = async (request: APIRequestContext) => ((await (await request.get(`${BASE}/api/warnings`, { headers: asAdmin })).json()) as unknown[]).length;

export async function newInvoice(request: APIRequestContext, agreementId: string, fields: Record<string, unknown> = {}) {
  const res = await request.post(`${BASE}/api/invoices`, {
    headers: asAdmin,
    data: { agreementId, invoiceNumber: unique("INV"), invoiceDate: "2026-11-01", amountMinor: 1_000_00, ...fields },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; invoiceNumber: string };
}

/** Calls the API as the admin, to set a test up or put a setting back. */
export const asAdminApi = (request: APIRequestContext, method: "post" | "put" | "patch", path: string, data: unknown) =>
  request[method](`${BASE}/api${path}`, { headers: asAdmin, data });

/** A small PDF with one line of text per paragraph, attached to an agreement as the admin. Invented text only. */
export async function attachPdf(request: APIRequestContext, agreementId: string, name: string, lines: string[]) {
  const { default: PDFDocument } = await import("pdfkit");
  const buffer = await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 64 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    for (const line of lines) doc.fontSize(11).text(line).moveDown();
    doc.end();
  });
  const res = await request.post(`${BASE}/api/agreements/${agreementId}/documents`, { headers: asAdmin, multipart: { file: { name, mimeType: "application/pdf", buffer } } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; fileName: string };
}
