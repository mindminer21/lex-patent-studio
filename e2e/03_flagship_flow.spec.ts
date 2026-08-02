import { expect, test } from "@playwright/test";

/**
 * Critical journeys (PRD §16 E2E): grounded chat, the full
 * compose → simulated run → review → approve → export loop, and the
 * verification/watermark guarantees along the way. Runs serially against
 * one local-mode server process.
 */

test.describe.configure({ mode: "serial" });

test("grounded chat: verified citations, labeled analysis, refusal", async ({
  page,
}) => {
  await page.goto("/app/matters/matter_thermal/chat");

  await page
    .getByLabel(/Ask about the law/)
    .fill("What is the grace period for an inventor-originated public demonstration?");
  await page.getByRole("button", { name: /Ask \(grounded\)/ }).click();

  await expect(page.locator("main")).toContainText("Lex — grounded reply");
  await expect(page.locator("main")).toContainText("Citations verified");
  await expect(page.locator("main")).toContainText("Analysis — not quoted authority");

  // Refusal path: nonsense query → explicit insufficiency, no citations.
  await page
    .getByLabel(/Ask about the law/)
    .fill("zymurgy quantum basketweaving jurisprudence");
  await page.getByRole("button", { name: /Ask \(grounded\)/ }).click();
  await expect(page.locator("main")).toContainText(/insufficient/i);
});

test("flagship loop: run → pending review → approve → export DOCX + PDF", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // 1. Compose a research-memo run (research_memo has no approved-fact
  //    gate; section_draft's zero-fact block is covered by unit tests).
  await page.goto("/app/matters/matter_thermal");
  const composer = page.getByRole("form", { name: "Run composer" });
  await composer.getByLabel("Task").selectOption("research_memo");
  await composer.getByRole("button", { name: /Queue run/i }).click();
  await expect(composer.getByRole("status")).toContainText(/Run queued \(Tier B/);

  // 2. The simulated pipeline finishes in ~20s; poll the documents tab.
  await expect
    .poll(
      async () => {
        await page.goto("/app/matters/matter_thermal/documents");
        return page
          .locator("main")
          .innerText()
          .then((t) => t.includes("research_memo (SIMULATED)"));
      },
      { timeout: 45_000, intervals: [3_000] },
    )
    .toBe(true);

  // Draft posture before approval: watermark + verified evidence set.
  const docCard = page
    .locator("article")
    .filter({ hasText: "research_memo (SIMULATED)" })
    .first();
  await expect(docCard).toContainText("DRAFT — NOT REVIEWED");
  await expect(docCard).toContainText("Citations verified");

  // 3. Approve it in the matter review queue (human decision).
  await page.goto("/app/matters/matter_thermal/reviews");
  const reviewCard = page
    .locator("article")
    .filter({ hasText: "research_memo (SIMULATED)" })
    .first();
  await expect(reviewCard).toContainText(/critic model/i);
  await reviewCard.getByLabel(/Decision note/).fill("E2E approval (synthetic)");
  await reviewCard.getByRole("button", { name: "Approve", exact: true }).click();
  // On approval the item leaves the pending list and re-renders under
  // "Decided" with the approved badge.
  await expect
    .poll(
      async () => {
        await page.goto("/app/matters/matter_thermal/reviews");
        const decided = await page
          .getByLabel("Decided items in this matter")
          .innerText()
          .catch(() => "");
        return decided.includes("research_memo (SIMULATED)");
      },
      { timeout: 20_000, intervals: [2_000] },
    )
    .toBe(true);

  // 4. Export — approved work exports without a watermark, in both formats.
  await page.goto("/app/matters/matter_thermal/documents");
  const approvedCard = page
    .locator("article")
    .filter({ hasText: "research_memo (SIMULATED)" })
    .first();
  await approvedCard.getByRole("button", { name: /Export DOCX \+ manifest/ }).click();
  await expect(approvedCard.getByRole("status")).toContainText(
    /as approved work product/,
  );

  const docxLink = approvedCard.locator('a[href^="/api/exports/"]').first();
  const href = await docxLink.getAttribute("href");
  expect(href).toBeTruthy();

  // DOCX bytes are a ZIP container; PDF bytes are a PDF without DRAFT chrome.
  const docxResponse = await page.request.get(href!);
  expect(docxResponse.status()).toBe(200);
  expect((await docxResponse.body()).subarray(0, 2).toString("latin1")).toBe("PK");

  const pdfResponse = await page.request.get(`${href}?format=pdf`);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  const pdfBytes = await pdfResponse.body();
  expect(pdfBytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  // The watermark chrome ("DRAFT — NOT REVIEWED") must be gone; the words
  // "SIMULATED DRAFT"/"DRAFTING BASIS" in body headings are legitimate.
  expect(pdfBytes.toString("latin1")).not.toContain("NOT REVIEWED");
  expect(pdfBytes.toString("latin1")).toContain("Review state: approved");
});

test("verifier failure blocks verified status end to end (Invariant 14)", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Queue a run with the local-mode tamper injection via the API (the UI
  // never exposes tampering; this is the failure-path drill).
  const created = await page.request.post("/api/matters/matter_thermal/runs", {
    headers: { "Idempotency-Key": `e2e-tamper-${Date.now()}` },
    data: {
      workflowKey: "research_memo",
      jurisdiction: "US",
      asOfDate: "2026-08-01",
      modelId: "claude-sonnet-4-5",
      deliverableType: "Cited research memo (tamper drill)",
      qualityControls: {
        sourceRequired: true,
        secondModelReview: true,
        quoteVerification: true,
      },
      factIds: [],
      sourceIds: [],
      simulate: { tamperQuote: true },
    },
  });
  expect(created.status()).toBe(201);

  await expect
    .poll(
      async () => {
        await page.goto("/app/matters/matter_thermal/reviews");
        return page
          .locator("main")
          .innerText()
          .then((t) => t.includes("tamper drill"));
      },
      { timeout: 45_000, intervals: [3_000] },
    )
    .toBe(true);

  const tamperCard = page
    .locator("article")
    .filter({ hasText: "tamper drill" })
    .first();
  await expect(tamperCard).toContainText("Verification failed");
  await expect(tamperCard).toContainText(/Verifier failure/i);
});
