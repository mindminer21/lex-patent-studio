import { expect, test } from "@playwright/test";
import { onboardFreshTenant, signIn, signOut } from "./helpers";

/**
 * Connected-counsel administration lane (PRD §6.3, §7.6): a requester
 * submits limited conflict intake; the intake administrator and attorney
 * walk the full state machine in the separate /counsel lane with role
 * guards enforced; representation labeling stays conspicuous throughout.
 */
test.describe.configure({ mode: "serial" });

const RUN = Date.now();
let requesterEmail = "";

test("requester submits a counsel request", async ({ page }) => {
  const tenant = await onboardFreshTenant(page, `lane-${RUN}`);
  requesterEmail = tenant.email;

  // Intake form was removed from the app (handled outside the application);
  // requests are created via the API and tracked in-app.
  const created = await page.request.post("/api/counsel-requests", {
    data: {
      requestSummary: "Consultation about protecting our synthetic separator design.",
      jurisdiction: "Colorado, USA",
      contactEmail: requesterEmail,
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/wepatent/app/counsel");
  await expect(page.getByText("Not yet represented")).toBeVisible();
  await page.getByRole("button", { name: "Submit conflict-intake request" }).click();
  await expect(page.getByText("Not yet represented")).toBeVisible();
  await signOut(page);
});

test("ordinary users cannot reach the counsel lane", async ({ page }) => {
  await signIn(page, requesterEmail, "Requester");
  await page.goto("/counsel/requests");
  await page.waitForURL(/\/wepatent\/sign-in/);
});

test("intake admin begins conflict review but cannot decide", async ({ page }) => {
  await signIn(page, "counsel-intake@wepatent.local", "Intake Admin");
  await page.waitForURL(/\/counsel/);
  await page.goto("/counsel/requests");
  await expect(page.getByText(/synthetic separator design/).first()).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await page.waitForURL(/\/counsel\/requests\/[0-9a-f-]+/);

  await expect(page.getByText("Not yet represented").first()).toBeVisible();
  // Intake can begin conflict review…
  await page.getByRole("button", { name: "Begin conflict review" }).click();
  await expect(page.getByText("conflict review", { exact: false }).first()).toBeVisible();
  // …but has no decide buttons.
  await expect(page.getByRole("button", { name: "Decline request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Offer consultation" })).toHaveCount(0);
  await signOut(page);
});

test("attorney offers consultation; requester schedules it", async ({ page }) => {
  await signIn(page, "counsel-attorney@wepatent.local", "Attorney");
  await page.goto("/counsel/requests");
  await page.getByRole("link", { name: "Open" }).first().click();
  await page.getByRole("button", { name: "Offer consultation" }).click();
  await expect(page.getByText("Not yet represented").first()).toBeVisible();
  await signOut(page);

  await signIn(page, requesterEmail, "Requester");
  await page.goto("/wepatent/app/counsel");
  await page.getByRole("button", { name: "Schedule consultation" }).click();
  await expect(page.getByText("Not yet represented")).toBeVisible();
  await expect(page.getByText(/Scheduling does not create representation/)).toBeVisible();
  await signOut(page);
});

test("attorney walks engagement → signed → matter with evidence required", async ({ page }) => {
  await signIn(page, "counsel-attorney@wepatent.local", "Attorney");
  await page.goto("/counsel/requests");
  await page.getByRole("link", { name: "Open" }).first().click();

  // Offer engagement (scope required by the form).
  await page
    .getByLabel("Engagement scope and fees summary")
    .fill("Provisional preparation for the separator design; fees per engagement letter.");
  await page.getByRole("button", { name: "Offer engagement" }).click();
  await expect(page.getByText("offered, not yet signed")).toBeVisible();
  await expect(page.getByText("Not yet represented").first()).toBeVisible();

  // Record the signed engagement with the document reference.
  await page
    .getByLabel("Signed engagement document reference (required)")
    .fill("engagement-letter-e2e.pdf");
  await page.getByRole("button", { name: "Record signed engagement" }).click();
  await expect(page.getByText("Engagement signed").first()).toBeVisible();

  // Convert to matter.
  await page.getByRole("button", { name: "Convert to matter" }).click();
  await expect(page.getByRole("link", { name: /Open matter M-/ })).toBeVisible();

  // Matter and filing-package workspace: preparation states only.
  await page.getByRole("link", { name: /Open matter M-/ }).click();
  await page.waitForURL(/\/counsel\/matters\/[0-9a-f-]+/);
  await expect(page.getByText(/wepatent never files/).first()).toBeVisible();
  await page.getByRole("link", { name: "Open the filing-package workspace" }).click();
  await page.getByLabel("Description").fill("Provisional draft set for counsel review.");
  await page.getByRole("button", { name: "Create filing package" }).click();
  await expect(page.getByText("in preparation").first()).toBeVisible();
  await page.getByRole("button", { name: "Send to counsel review" }).click();
  await expect(page.getByText("counsel review", { exact: false }).first()).toBeVisible();
  await signOut(page);
});

test("requester sees signed engagement with scope, never a blanket 'represented'", async ({
  page,
}) => {
  await signIn(page, requesterEmail, "Requester");
  await page.goto("/wepatent/app/counsel");
  await expect(page.getByText("Engagement signed").first()).toBeVisible();
  await expect(page.getByText(/engagement-letter-e2e\.pdf/).first()).toBeVisible();
  await expect(
    page.getByText(/only as defined by the signed engagement letter/).first(),
  ).toBeVisible();
});
