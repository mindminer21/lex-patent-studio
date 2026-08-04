import { expect, test, type Page } from "@playwright/test";
import {
  acceptClickwrapByKeyboard,
  onboardFreshTenant,
  placeholderOrgName,
  signIn,
} from "./helpers";

/**
 * The core workspace journey (PRD §13): sign-in (organization auto-created)
 * → clickwrap keyboard flow → staged intake with autosave/resume → estimate →
 * durable generation → draft review → export with rendered artifacts →
 * counsel request ("not represented") → billing view.
 */
test.describe.configure({ mode: "serial" });

const RUN = Date.now();
const FOUNDER_EMAIL = `founder-${RUN}@example.test`;
// The first organization is auto-created on first sign-in with a
// placeholder name derived from the email local-part (friction audit #5).
const ORG_NAME = placeholderOrgName(FOUNDER_EMAIL);

async function openSeededInvention(page: Page): Promise<void> {
  await page.goto("/wepatent/app");
  await page
    .getByRole("link", { name: /Modular battery enclosure/ })
    .first()
    .click();
  await page.waitForURL(/\/wepatent\/app\/inventions\/[0-9a-f-]+$/);
}

test("sign-in auto-creates the organization, then keyboard clickwrap", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");

  // Design rule (minimal human input): there is NO "Create your
  // organization" step — sign-in lands straight on the clickwrap, which
  // stays a required explicit action.
  await page.waitForURL(/\/wepatent\/app\/terms/);
  await expect(page.getByRole("button", { name: "Create organization" })).toHaveCount(0);

  // Clickwrap: server-enforced four acknowledgements, keyboard-only flow.
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await acceptClickwrapByKeyboard(page);

  // Dashboard shows the org and the seeded synthetic record.
  await expect(page.getByText(ORG_NAME).first()).toBeVisible();
  await expect(page.getByText("Synthetic example").first()).toBeVisible();
});

test("staged intake autosaves, resumes, and submits to the invention record", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await page.goto("/wepatent/app/inventions/new");

  // Design rule (minimal human input): there is no "Save draft" button.
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);

  // Stage 1: identity.
  await page.getByLabel("Invention title").fill("E2E cooling manifold");
  await page
    .getByLabel("Short summary")
    .fill("A synthetic end-to-end test invention with a sufficiently long summary.");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Problem and technical solution" })).toBeVisible();

  // Stage 2: type a PARTIAL (still invalid) stage, let autosave fire on
  // blur, leave the page entirely, and resume with the typing intact.
  await page.getByLabel("Problem addressed").fill("Heat spikes degrade the synthetic cells.");
  await page.getByLabel("Problem addressed").blur();
  await expect(page.getByTestId("intake-draft-status")).toContainText("Draft saved", {
    timeout: 10_000,
  });
  await page.goto("/wepatent/app");
  await page.goto("/wepatent/app/inventions/new");
  await expect(page.getByRole("heading", { name: "Problem and technical solution" })).toBeVisible();
  await expect(page.getByLabel("Problem addressed")).toHaveValue(
    "Heat spikes degrade the synthetic cells.",
  );

  // Finish stage 2 and the rest.
  await page
    .getByLabel("Technical solution")
    .fill("A passive manifold spreads transient heat across phase-change cartridges.");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Components, steps/ })).toBeVisible();
  await page
    .getByLabel("Components (one per line)")
    .fill("Manifold body — aluminum heat spreader\nCartridge — replaceable PCM insert");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Contributors and contribution/ })).toBeVisible();
  await page
    .getByLabel("Contributors (one per line)")
    .fill("Casey Synthetic <casey@example.test> — designed the manifold geometry");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Disclosure and commercialization/ })).toBeVisible();
  await page.getByText("We have no disclosure, sale, publication, or demo events yet.").click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Ownership and assignment/ })).toBeVisible();
  await page
    .getByLabel("Do contributors have employment/IP agreements with your company?")
    .selectOption("yes");
  await page
    .getByLabel("Have invention assignments been executed for this invention?")
    .selectOption("unsure");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Source upload and extraction/ })).toBeVisible();
  await page.getByText("We have no source documents to register yet.").click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: /Review and submission/ })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit to invention record" }).click();
  await page.waitForURL(/\/wepatent\/app\/inventions\/[0-9a-f-]+$/);
  await expect(page.getByText("E2E cooling manifold").first()).toBeVisible();
  // Unsure ownership answers surface as unresolved facts, never conclusions.
  await page.goto(`${page.url()}/facts`);
  await expect(page.getByText(/assignments executed = unsure/).first()).toBeVisible();
});

test("estimate → durable generation → draft review with required labels", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await openSeededInvention(page);
  const inventionUrl = page.url();

  await page.goto(`${inventionUrl}/drafts`);
  // Estimate and wallet sufficiency are visible before the run (PRD §7.4).
  await expect(page.getByText(/Wallet available:/)).toBeVisible();
  await expect(page.getByLabel("Model tier")).toContainText("est. $");

  await page.getByRole("button", { name: "Reserve and generate" }).click();
  await page.waitForURL(/drafts\?job=/);

  // Durable-job progress, then the produced version (PRD §14).
  await page.waitForURL(/drafts\?version=/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Draft version 1/ })).toBeVisible();
  await expect(page.getByText("WORKING DRAFT — COUNSEL REVIEW REQUIRED").first()).toBeVisible();
  await expect(page.getByText(/Model: wepatent-local-standard/)).toBeVisible();
  await expect(page.getByText(/Actual charge: \$/)).toBeVisible();
  await expect(page.getByText(/Rate version:/)).toBeVisible();
});

test("export creation renders DOCX/PDF artifacts with checksums", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await openSeededInvention(page);
  const inventionUrl = page.url();

  await page.goto(`${inventionUrl}/export`);
  // Design rule (minimal human input): all sections are included by
  // default and the checkboxes are collapsed, so this is ONE click.
  const customize = page.getByTestId("customize-sections");
  await expect(customize).toBeVisible();
  await expect(customize).not.toHaveAttribute("open", /.*/);
  await expect(page.getByRole("checkbox", { name: "Facts" })).toBeHidden();
  await page.getByRole("button", { name: "Create version-locked export" }).click();
  await page.waitForURL(/\/export$/);

  // The render job runs off the request path; poll the page briefly.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("counsel-package.docx")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("counsel-package.pdf")).toBeVisible();
  await expect(page.getByText("manifest.json")).toBeVisible();
  // Default-state export really did include every section (manifest is
  // rendered verbatim on the page); version-locking semantics unchanged.
  for (const section of ["facts", "contributors", "timeline", "sources", "ps_ledger", "coverage"]) {
    await expect(page.getByText(`"${section}"`).first()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Download" }).first()).toBeVisible();
  await expect(page.getByText(/checksum/i).first()).toBeVisible();

  // A download link actually serves bytes with the checksum header.
  const href = await page.getByRole("link", { name: "Download" }).first().getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["x-checksum-sha256"]).toMatch(/^[0-9a-f]{64}$/);
});

test("counsel request shows conspicuous not-represented status", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  const created = await page.request.post("/api/counsel-requests", {
    data: {
      requestSummary: "Consultation about protecting our synthetic separator design.",
      jurisdiction: "Colorado, USA",
      contactEmail: FOUNDER_EMAIL,
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/wepatent/app/counsel");

  await expect(page.getByText("Not yet represented")).toBeVisible();
  await page.getByRole("button", { name: "Submit conflict-intake request" }).click();
  await expect(page.getByText("Not yet represented")).toBeVisible();
  await expect(
    page.getByText(/does not create an attorney-client relationship/).first(),
  ).toBeVisible();
});

test("billing view shows wallet, ledger, and settled usage", async ({ page }) => {
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await page.goto("/wepatent/app/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText("Wallet balance")).toBeVisible();
  // The published rate is derived from the markup catalog and follows the
  // TASK TYPE (Jeff's directive, 2026-08-04): 2.0 for generation, 1.5 for
  // analysis. Both are named — neither is an unstated exception.
  await expect(
    page.getByRole("heading", { name: "cost × 2.0 generation / × 1.5 analysis" }),
  ).toBeVisible();
  await expect(
    page.getByText("provider cost × 2.0 for generation tasks, × 1.5 for analysis tasks").first(),
  ).toBeVisible();
  // The generation earlier in this suite settled against the wallet.
  await expect(page.getByText(/AI usage settlement/).first()).toBeVisible();
  await expect(page.getByText(/promotional credit/i).first()).toBeVisible();
});

test("settings retention window autosaves without an Update button", async ({ page }) => {
  // Design rule (minimal human input): the owner edits the number and it
  // saves + audits automatically — verified across a real reload.
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await page.goto("/wepatent/app/settings");
  const retention = page.getByTestId("retention-days");
  await expect(retention).toBeVisible();
  await expect(page.getByRole("button", { name: /Update retention/ })).toHaveCount(0);
  await retention.fill("180");
  await expect(page.getByTestId("retention-status")).toContainText("Saved and audited", {
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByTestId("retention-days")).toHaveValue("180");
  await expect(page.getByText("180 days")).toBeVisible();
  // Out-of-range input is refused client-side and never saved.
  await page.getByTestId("retention-days").fill("5");
  await page.getByTestId("retention-days").blur();
  await expect(page.getByTestId("retention-status")).toContainText("30–3650");
  await page.reload();
  await expect(page.getByTestId("retention-days")).toHaveValue("180");
  // The audit trail shows the policy update.
  await expect(page.getByText("retention.policy_updated").first()).toBeVisible();
});

test("organization name autosaves in Settings (placeholder → real name)", async ({ browser }) => {
  // Friction audit #5: the org is auto-created with a placeholder name and
  // renamed here — an autosaving field, no Save button, no blocking step.
  const context = await browser.newContext();
  const page = await context.newPage();
  const { email } = await onboardFreshTenant(page, "org-rename");

  await page.goto("/wepatent/app/settings");
  const nameField = page.getByTestId("organization-name");
  await expect(nameField).toHaveValue(placeholderOrgName(email));
  await expect(page.getByRole("button", { name: /Create organization/ })).toHaveCount(0);

  await nameField.fill("Bright Idea Labs");
  await nameField.blur();
  await expect(page.getByTestId("organization-name-status")).toContainText("Saved and audited", {
    timeout: 10_000,
  });

  await page.reload();
  await expect(page.getByTestId("organization-name")).toHaveValue("Bright Idea Labs");
  await expect(page.getByText("Bright Idea Labs").first()).toBeVisible();
  await expect(page.getByText("organization.renamed").first()).toBeVisible();

  // Too-short names are refused client-side and never saved.
  await page.getByTestId("organization-name").fill("x");
  await page.getByTestId("organization-name").blur();
  await expect(page.getByTestId("organization-name-status")).toContainText("2–120");
  await page.reload();
  await expect(page.getByTestId("organization-name")).toHaveValue("Bright Idea Labs");
  await context.close();
});

test("cross-tenant access is denied by URL and API tampering", async ({ browser, page }) => {
  // Tenant A: capture a real invention id.
  await signIn(page, FOUNDER_EMAIL, "E2E Founder");
  await openSeededInvention(page);
  const inventionAUrl = new URL(page.url());
  const inventionAPath = inventionAUrl.pathname;
  const inventionAId = inventionAPath.split("/").pop()!;

  // Tenant B in an isolated browser context.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await onboardFreshTenant(pageB, "intruder");

  // UI tampering: A's invention 404s for B.
  const uiResponse = await pageB.goto(inventionAPath);
  expect(uiResponse?.status()).toBe(404);

  // API tampering: 404, not another org's data.
  const apiResponse = await pageB.request.get(`/api/inventions/${inventionAId}`);
  expect(apiResponse.status()).toBe(404);

  // B sees only its own seeded invention on the dashboard, never A's org.
  await pageB.goto("/wepatent/app");
  await expect(pageB.getByText(ORG_NAME)).toHaveCount(0);
  await contextB.close();
});
