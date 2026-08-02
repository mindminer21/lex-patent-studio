import { expect, test } from "@playwright/test";

test.describe("public routes and legacy redirects (PRD §6.1, §13)", () => {
  test("landing page renders with security headers", async ({ page }) => {
    const response = await page.goto("/wepatent");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("legacy /venture permanently redirects to /wepatent", async ({ request }) => {
    const response = await request.get("/venture", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toContain("/wepatent");
  });

  test("legacy /venture subpaths carry over", async ({ request }) => {
    const response = await request.get("/venture/pricing", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toContain("/wepatent/pricing");
  });

  test("legacy /self-service-terms redirects to /wepatent/terms", async ({ request }) => {
    const response = await request.get("/self-service-terms", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toContain("/wepatent/terms");
  });

  test("unauthenticated /wepatent/app is pushed to sign-in", async ({ page }) => {
    await page.goto("/wepatent/app");
    await page.waitForURL(/\/wepatent\/sign-in/);
  });

  test("public pages carry the not-a-law-firm boundary", async ({ page }) => {
    await page.goto("/wepatent");
    await expect(page.getByText(/not a law firm/i).first()).toBeVisible();
  });
});
