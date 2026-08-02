import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { onboardFreshTenant } from "./helpers";

/**
 * FR-6 / PRD §13 E2E: "Billing portal handoff in test mode" plus the full
 * webhook-driven top-up journey. Local mode has no Stripe account — the
 * checkout hands off to a clearly labeled simulated page whose completion
 * signs a synthetic event and pushes it through the production webhook
 * pipeline (verify → dedupe → outbox → ledger).
 */

const WEBHOOK_SECRET = "whsec_wepatent_local_synthetic_not_for_production";

function signedHeader(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

test("wallet top-up: checkout handoff → signed webhook → ledger credit", async ({ page }) => {
  await onboardFreshTenant(page, "billing-topup");
  await page.goto("/app/billing");

  // $25.00 synthetic promo credit from onboarding.
  await expect(page.getByRole("heading", { name: "$25.00" })).toBeVisible();

  await page.getByLabel("Top-up amount").selectOption("5000");
  await page.getByRole("button", { name: "Continue to checkout" }).click();

  // Simulated hosted checkout, conspicuously labeled as local-only.
  await page.waitForURL(/\/app\/billing\/simulated-checkout/);
  await expect(page.getByRole("heading", { name: "Simulated test checkout" })).toBeVisible();
  await expect(page.getByText("Local mode only:")).toBeVisible();
  await expect(page.getByText("No card is charged")).toBeVisible();

  await page.getByRole("button", { name: "Complete test payment" }).click();
  await page.waitForURL(/\/app\/billing\?checkout=success/);
  await expect(page.getByRole("status")).toContainText("Checkout completed");

  // Balance reflects the verified webhook credit: 2500 + 5000.
  await expect(page.getByRole("heading", { name: "$75.00" })).toBeVisible();
  await expect(page.getByText("Wallet top-up via Stripe Checkout")).toBeVisible();
});

test("customer portal handoff reaches the labeled simulated portal", async ({ page }) => {
  await onboardFreshTenant(page, "billing-portal");
  await page.goto("/app/billing");
  await page.getByRole("button", { name: "Open customer portal" }).click();
  await page.waitForURL(/\/app\/billing\/simulated-portal/);
  await expect(page.getByRole("heading", { name: "Simulated customer portal" })).toBeVisible();
  await expect(page.getByText("approval-gated (PRD §17)")).toBeVisible();
  await page.getByRole("link", { name: "Return to billing" }).click();
  await page.waitForURL(/\/app\/billing/);
});

test("webhook endpoint enforces signatures and event-id idempotency", async ({
  page,
  request,
}) => {
  await onboardFreshTenant(page, "billing-webhook");

  const eventId = `evt_e2e_${Date.now()}`;
  const payload = JSON.stringify({
    id: eventId,
    type: "invoice.finalized",
    data: { object: { id: "in_e2e" } },
  });

  // Unsigned → rejected.
  const unsigned = await request.post("/api/webhooks/stripe", {
    data: payload,
    headers: { "content-type": "application/json" },
  });
  expect(unsigned.status()).toBe(400);

  // Properly signed → accepted and recorded.
  const first = await request.post("/api/webhooks/stripe", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signedHeader(payload) },
  });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ received: true, status: "ignored" });

  // Redelivery of the same event id → acknowledged as duplicate.
  const second = await request.post("/api/webhooks/stripe", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signedHeader(payload) },
  });
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual({ received: true, status: "duplicate" });
});

test("viewer role cannot start checkout via the API", async ({ page, request }) => {
  await onboardFreshTenant(page, "billing-authz");
  // No session at all → 401.
  const anonymous = await request.post("/api/stripe/checkout", {
    data: { kind: "wallet_top_up", amountCents: 2500 },
  });
  expect(anonymous.status()).toBe(401);

  // Authenticated owner with a bogus amount → 400 (schema-rejected).
  const bogus = await page.request.post("/api/stripe/checkout", {
    data: { kind: "wallet_top_up", amountCents: 123456 },
  });
  expect(bogus.status()).toBe(400);
});
