import AxeBuilder from "@axe-core/playwright";
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const ADMIN = "admin@example.test";
export const MEMBER = "mira@example.test";

/** Look at the app as this person (the local stand-in for company sign-in). */
export async function signInAs(context: BrowserContext, email: string) {
  await context.clearCookies();
  await context.addCookies([{ name: "dev_user", value: email, url: "http://127.0.0.1:4173" }]);
}

/** X-1: no accessibility violations that an automated check can find. */
export async function expectAccessible(page: Page) {
  // Let entrance animations finish so colours are measured at rest.
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}
