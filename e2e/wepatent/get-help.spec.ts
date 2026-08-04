import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { onboardFreshTenant } from "./helpers";

/**
 * "Get Help to File Your Applications" page (/wepatent/app/counsel):
 * records list with working-draft framing, the USPTO self-filing button,
 * the attorney button with the adjacent no-relationship disclaimer, and a
 * filing-receipt upload through the unchanged FR-4 pipeline — with the
 * representation banner intact and the page axe-clean.
 */

const RECEIPT_PDF = Buffer.from(
  "%PDF-1.7\nSynthetic USPTO filing receipt. Application 63/000,000 (e2e fixture).\n%%EOF",
);

test("get-help page: records list, both buttons, disclaimer, receipt upload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await onboardFreshTenant(page, "gethelp");

  // Create an invention record so the draft-applications list has a row.
  // The path chooser has no naming step; typing into the studio's
  // auto-saving title field (design rule: no Save button) renames the
  // record itself (title linkage under test).
  await page.goto("/wepatent/app/inventions/start");
  await page.getByRole("button", { name: "Create record and upload files" }).click();
  await page.waitForURL(/\/studio$/);
  await page.getByTestId("working-title").fill("Receipt-test valve (e2e)");
  await expect(page.getByTestId("title-status")).toContainText("Saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("working-title")).toHaveValue("Receipt-test valve (e2e)");

  // Sidebar label renamed; the page keeps its route.
  await page.goto("/wepatent/app");
  await page.getByRole("link", { name: "Get Help to File" }).click();
  await page.waitForURL(/\/wepatent\/app\/counsel$/);

  await expect(
    page.getByRole("heading", { name: "Get Help to File Your Applications" }),
  ).toBeVisible();

  // Representation boundary stays conspicuous.
  await expect(page.getByText("Not represented")).toBeVisible();
  await expect(
    page.getByText(/never creates representation/).first(),
  ).toBeVisible();

  // Records list: title + honest working-draft badge + draft/export status.
  // (Local mode also seeds a synthetic example record; scope to ours.)
  const record = page
    .getByTestId("help-record")
    .filter({ hasText: "Receipt-test valve (e2e)" });
  await expect(record).toHaveCount(1);
  await expect(record.getByRole("link", { name: "Receipt-test valve (e2e)" })).toBeVisible();
  await expect(
    record.getByText("Working record — counsel review required"),
  ).toBeVisible();
  await expect(record.getByText(/0 draft versions across 0 drafts/)).toBeVisible();
  await expect(record.getByText(/no exports yet/)).toBeVisible();

  // USPTO self-filing button: external, new tab, no opener.
  const usptoLink = page.getByRole("link", {
    name: "Go to USPTO website for self-filing instructions",
  });
  await expect(usptoLink).toHaveAttribute(
    "href",
    "https://www.uspto.gov/patents/basics/apply",
  );
  await expect(usptoLink).toHaveAttribute("target", "_blank");
  await expect(usptoLink).toHaveAttribute("rel", /noopener/);
  // Pro se framing near the button — the user's own decision, drafts need review.
  await expect(page.getByText(/your own pro se decision/)).toBeVisible();

  // Attorney button with the adjacent compliance disclaimer (ethics memo §2).
  const attorneyLink = page.getByRole("link", { name: "Get help from an attorney" });
  await expect(attorneyLink).toHaveAttribute(
    "href",
    "https://cal.com/jeffschell/talktoapatentlawyer",
  );
  await expect(attorneyLink).toHaveAttribute("target", "_blank");
  await expect(attorneyLink).toHaveAttribute("rel", /noopener/);
  await expect(
    page.getByText(
      /Scheduling a consultation does not create an attorney-client relationship\. Please do not share confidential invention details until the attorney has completed a conflict check and you have a signed engagement letter\./,
    ),
  ).toBeVisible();

  // The structured conflict-screening intake was removed (handled outside
  // the application); no in-app creation form is offered.
  await expect(
    page.getByRole("heading", { name: "Structured conflict-screening intake" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create draft request" })).toHaveCount(0);

  // Upload a filing receipt (fixture PDF) through the FR-4 pipeline.
  // Design rule (minimal human input): choosing the file starts the upload
  // — there is no "Upload filing receipt" button anymore.
  await expect(record.getByText("No filing receipts uploaded yet.", { exact: false })).toBeVisible();
  await expect(record.getByRole("button", { name: "Upload filing receipt" })).toHaveCount(0);
  await record.getByLabel(/Upload a filing receipt/).setInputFiles({
    name: "uspto-filing-receipt.pdf",
    mimeType: "application/pdf",
    buffer: RECEIPT_PDF,
  });
  await expect(page.getByTestId("filing-receipt-message")).toContainText(
    "Filing receipt uploaded",
    { timeout: 15_000 },
  );

  // The receipt appears in the record's "Filing receipts" list with a date.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("uspto-filing-receipt.pdf").count();
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  const receiptRow = record.locator(".wp-timeline li").first();
  await expect(receiptRow.getByText("uspto-filing-receipt.pdf")).toBeVisible();
  await expect(receiptRow.locator(".when")).not.toHaveText("");

  // Axe: no serious/critical violations on the reworked page.
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
});
