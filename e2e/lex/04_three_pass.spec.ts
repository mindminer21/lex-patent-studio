import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * LEX'S THREE-PASS JOURNEY (Jeff's directive, 2026-08-04).
 *
 * The same flow as wepatent's, on the same shared core, in Lex's clothes:
 * Tier B, the practitioner review queue, and a practitioner acceptance.
 *
 * As in the wepatent journey, the load-bearing assertions are the refusals.
 */

const MATTER = "/app/matters/matter_thermal";

test("Lex three-pass: draft → brief w/ numerals → figures → revised draft → gate → accept", async ({
  page,
}) => {
  test.setTimeout(120_000);

  /* ---- the surface exists and explains the flow before anything runs -- */
  await page.goto(`${MATTER}/documents`);
  const panel = page.getByTestId("lex-three-pass");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("illustrations brief");
  await expect(panel).toContainText("reference numerals");
  // Tier semantics are stated up front: this is draft-for-review work.
  await expect(panel).toContainText("Tier B");
  await expect(panel).toContainText("review queue");

  /* ---- ONE control starts the whole flow ------------------------------ */
  await page.getByTestId("lex-start-three-pass").click();
  await page.waitForURL(/\/documents/);

  // Pass 1 → figures → Pass 2 chain with no practitioner step in between.
  await expect
    .poll(
      async () => {
        await page.reload();
        return (await page.getByTestId("lex-pass-state").textContent()) ?? "";
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toMatch(/Ready for review|Needs your input|Paused|Failed/);

  const state = (await page.getByTestId("lex-pass-state").textContent()) ?? "";

  if (state.includes("Ready for review")) {
    /* ---- the two-way §608.02 check passed ----------------------------- */
    await expect(page.getByTestId("lex-reconciled")).toHaveText("yes");
    await expect(panel).toContainText("in the practitioner review queue");

    /* ---- THE GATE still refuses until a practitioner accepts ---------- */
    const blockers = page.getByTestId("lex-delivery-blockers");
    await expect(blockers).toBeVisible();
    await expect(blockers).toContainText("accept");

    /* ---- both passes produced a document; neither replaced the other -- */
    await expect(page.locator("body")).toContainText("first pass");
    await expect(page.locator("body")).toContainText("second pass");

    /* ---- the practitioner accepts ------------------------------------- */
    const accept = page.getByTestId("lex-accept-draft-set");
    await expect(accept).toBeEnabled();
    await accept.click();
    await page.waitForURL(/\/documents/);
    await expect(page.getByTestId("lex-accepted")).toBeVisible();
    await expect(page.getByTestId("lex-accepted")).toContainText("Tier-B draft for review");
  } else {
    /* ---- it stopped, and it must say exactly why ---------------------- */
    await expect(page.getByTestId("lex-status-detail")).toBeVisible();
    const detail = (await page.getByTestId("lex-status-detail").textContent()) ?? "";
    expect(detail.trim().length).toBeGreaterThan(20);
    // Never a bare "not ready".
    expect(detail.trim().toLowerCase()).not.toBe("not ready");
    // And the gate stays shut.
    await expect(page.getByTestId("lex-reconciled")).toHaveText("not yet");
  }
});

test("the Lex three-pass surface is keyboard reachable and passes axe", async ({ page }) => {
  await page.goto("/app/matters/matter_optical/documents");
  const panel = page.getByTestId("lex-three-pass");
  await expect(panel).toBeVisible();

  const start = page.getByTestId("lex-start-three-pass");
  if (await start.isVisible()) {
    await start.focus();
    await expect(start).toBeFocused();
  }

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
