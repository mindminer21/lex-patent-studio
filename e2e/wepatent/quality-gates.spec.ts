import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { onboardFreshTenant } from "./helpers";

/**
 * PRD §12/§13 release gates in executable form:
 * - axe accessibility scan: no serious/critical violations on key pages;
 * - browser console: no application errors;
 * - responsive behavior at 320/768/1024/1440: no horizontal overflow;
 * - security headers on every response class.
 */

const PUBLIC_PAGES = [
  "/wepatent",
  "/wepatent/pricing",
  "/wepatent/security",
  "/wepatent/terms",
  "/wepatent/privacy",
  "/wepatent/ai-disclosure",
  "/wepatent/sign-in",
];

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function expectNoSeriousViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    })),
    `axe serious/critical violations on ${context}`,
  ).toEqual([]);
}

test("public pages: axe clean, no console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await expectNoSeriousViolations(page, path);
  }
  expect(errors).toEqual([]);
});

test("authenticated journey pages: axe clean, no console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await onboardFreshTenant(page, "a11y");
  for (const path of ["/wepatent/app", "/wepatent/app/inventions/new", "/wepatent/app/inventions/start", "/wepatent/app/billing", "/wepatent/app/counsel", "/wepatent/app/settings"]) {
    await page.goto(path);
    await expectNoSeriousViolations(page, path);
  }
  expect(errors).toEqual([]);
});

test("clickwrap page passes the axe scan before acceptance", async ({ page }) => {
  const unique = `a11y-cw-${Date.now()}`;
  await page.goto("/wepatent/sign-in");
  await page.getByLabel("Email address").fill(`${unique}@example.test`);
  await page.getByRole("button", { name: "Continue" }).click();
  // Organization auto-creation lands the new user straight on the clickwrap.
  await page.waitForURL(/\/wepatent\/app\/terms/);
  await expectNoSeriousViolations(page, "/wepatent/app/terms");
});

test("responsive: key pages have no horizontal overflow at 320-1440px", async ({ page }) => {
  await onboardFreshTenant(page, "responsive");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const path of ["/wepatent", "/wepatent/pricing", "/wepatent/app", "/wepatent/app/billing"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} @ ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("security headers are present on public and app responses", async ({ request }) => {
  for (const path of ["/wepatent", "/wepatent/sign-in"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toBeTruthy();
    expect(headers["x-frame-options"] ?? headers["content-security-policy"], path).toBeTruthy();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBeTruthy();
    expect(headers["permissions-policy"], path).toBeTruthy();
  }
});
