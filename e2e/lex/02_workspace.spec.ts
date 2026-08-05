import { expect, test } from "@playwright/test";

/**
 * Authenticated workspace surfaces (PRD §8.2, §15). Local mode signs in a
 * synthetic practitioner automatically; all data is synthetic.
 */

test("home dashboard: review queue, tier tiles, deadline disclaimer", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
  // Exactly one h1 (WCAG structure rule).
  expect(await page.locator("h1").count()).toBe(1);
  // Local-mode banner and the mandatory not-a-docketing disclaimer.
  await expect(page.locator("body")).toContainText("Local mode — synthetic data");
  await expect(page.locator("body")).toContainText(
    "not a docketing system — verify every date against your docket",
  );
});

test("matter workspace: composer contract fields and tier floor label", async ({
  page,
}) => {
  await page.goto("/app/matters");
  await page.getByRole("link", { name: "LEX-2026-0007" }).first().click();
  await expect(page).toHaveURL(/matters\/matter_thermal/);

  const composer = page.getByRole("form", { name: "Run composer" });
  await expect(composer).toBeVisible();
  // §8.3: task, jurisdiction + as-of, model picker, deliverable, QC, estimate.
  await expect(composer.getByLabel("Task")).toBeVisible();
  await expect(composer.getByLabel("Jurisdiction")).toBeVisible();
  await expect(composer.getByLabel(/As-of date/)).toBeVisible();
  await expect(composer.getByLabel(/Deliverable type/)).toBeVisible();
  await expect(composer).toContainText("Estimated charge range");
  await expect(composer).toContainText("platform policy, not demotable");
  // The rate follows the TASK, not the model (Jeff's directive, 2026-08-04):
  // section_draft is a generation workflow, so the composer quotes 2.0.
  await expect(composer).toContainText("provider cost × 2.0");
  await expect(composer).toContainText("generation");
});

/**
 * The matter tab bar is Jeff's approved six-tab set (2026-08-04). Every
 * §8.2 route still exists and still renders its surface — the five that
 * left the tab bar are reached from the surface that already shows their
 * content, so this spec navigates the way a user actually would.
 */
test("every §8.2 matter tab renders its surface", async ({ page }) => {
  const tabbed: Array<[string, string | RegExp]> = [
    ["Chat", "Grounded chat"],
    ["Documents", /document|export/i],
    ["Claims", /claim/i],
    ["Reviews", "Review queue for this matter"],
    ["Activity", /audit|activity/i],
  ];
  const nav = page.getByRole("navigation", { name: "Matter sections" });
  await page.goto("/app/matters/matter_thermal");
  await expect(nav.getByRole("link")).toHaveText([
    "Workspace",
    "Chat",
    "Documents",
    "Claims",
    "Reviews",
    "Activity",
  ]);
  for (const [tab, expected] of tabbed) {
    await nav.getByRole("link", { name: tab, exact: true }).click();
    await expect(page.locator("main")).toContainText(expected);
  }
});

test("every §8.2 route dropped from the tab bar renders, reached in context", async ({
  page,
}) => {
  // Facts, Sources, and Citations hang off the workspace panels that
  // already display them; Workflows off the run composer's task picker;
  // Counsel off the matter header (counsel status has no other home).
  const contextual: Array<[RegExp, RegExp, string | RegExp]> = [
    [/Full fact ledger/, /\/facts$/, /fact ledger|provenance|Counsel reviewed/i],
    [/All sources and extraction status/, /\/sources$/, /extraction|upload/i],
    [/Authority panel and citation checks/, /\/citations$/, "Authority panel"],
    [/Workflow catalog, tier floors, and run history/, /\/workflows$/, "Guided workflows"],
    [/^Connected counsel$/, /\/counsel$/, "NOT YET REPRESENTED"],
  ];
  for (const [linkName, url, expected] of contextual) {
    await page.goto("/app/matters/matter_thermal");
    await page.getByRole("link", { name: linkName }).first().click();
    await expect(page).toHaveURL(url);
    await expect(page.locator("main")).toContainText(expected);
  }
});

test("knowledge browser: point-in-time search returns the edition in force", async ({
  page,
}) => {
  await page.goto("/app/knowledge");
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await page.getByLabel("Query").fill("obviousness rationales prima facie");
  await page.getByLabel(/As-of date/).fill("2013-01-15");
  await page.getByRole("button", { name: /Search as of date/ }).click();
  // The superseded 8th-edition MPEP entry is the one in force in 2013.
  await expect(page.locator("main")).toContainText("8th ed., Rev. 9");
  // License gate is visible in the registry table.
  await expect(page.locator("main")).toContainText("No — license gate");
});

test("citations tab shows verification states and labeled analysis", async ({
  page,
}) => {
  await page.goto("/app/matters/matter_thermal/citations");
  await expect(page.locator("main")).toContainText("35 U.S.C. § 112");
  await expect(page.locator("main")).toContainText("Citations verified");
  await expect(page.locator("main")).toContainText("Analysis — not quoted authority");
});

test("keyboard: matter tabs are reachable and operable via keyboard", async ({
  page,
}) => {
  await page.goto("/app/matters/matter_thermal");
  const claimsTab = page
    .getByRole("navigation", { name: "Matter sections" })
    .getByRole("link", { name: "Claims", exact: true });
  await claimsTab.focus();
  await expect(claimsTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/claims/);

  // The contextual links that replaced the dropped tabs are keyboard
  // operable too — a removed tab must not mean a mouse-only route.
  await page.goto("/app/matters/matter_thermal");
  const factsLink = page.getByRole("link", { name: /Full fact ledger/ });
  await factsLink.focus();
  await expect(factsLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/facts/);
});

test("responsive: workspace usable at 320px without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/app");
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
