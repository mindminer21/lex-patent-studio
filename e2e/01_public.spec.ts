import { expect, test } from "@playwright/test";

/**
 * Public marketing surface (PRD §8.1, §15, DESIGN-HANDOFF content rules).
 */

test("home page: identity, supervision qualifier, and no prohibited claims", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Lex Patent Studio/);

  const body = await page.locator("body").innerText();
  // Supervised-workflow positioning present…
  expect(body).toMatch(/practitioner/i);
  // …and the prohibited claims are absent (marketing rule §1, memo §2.4).
  expect(body).not.toMatch(/AI patent lawyer/i);
  expect(body).not.toMatch(/lawyer replacement/i);
  expect(body).not.toMatch(/guaranteed (allowance|patentability)/i);
  expect(body).not.toMatch(/file without review/i);

  // Primary navigation reaches the §8.1 routes.
  await page.getByRole("navigation", { name: /primary/i }).getByText("Pricing").click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.locator("body")).toContainText("$149");
});

test("security headers are served", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("responsive: no horizontal overflow at 320px on the home page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("wepatent design-proof route stays separate from Lex identity", async ({
  page,
}) => {
  await page.goto("/wepatent");
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/wepatent/i);
  // The self-service lane must state its boundary.
  expect(body).toMatch(/not (a law firm|legal advice)/i);
});
