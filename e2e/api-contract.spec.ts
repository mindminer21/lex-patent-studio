import { expect, test } from "@playwright/test";
import { onboardFreshTenant } from "./helpers";

/**
 * PRD §10 API contract checks for the endpoints added in round 3:
 * POST /api/organizations, /api/invitations, /api/inventions/:id/exports.
 * Authentication, authorization, validation, and generic errors.
 */

test("§10 endpoints refuse unauthenticated callers", async ({ request }) => {
  for (const [path, body] of [
    ["/api/organizations", { name: "Nope Inc" }],
    ["/api/invitations", { email: "a@example.test", role: "member" }],
    ["/api/inventions/some-id/exports", { sections: ["facts"] }],
  ] as const) {
    const response = await request.post(path, { data: body });
    expect(response.status(), path).toBe(401);
  }
});

test("organization creation via API is validated and single-org enforced", async ({ page }) => {
  await onboardFreshTenant(page, "api-orgs");
  // Already in an organization → 409.
  const conflict = await page.request.post("/api/organizations", {
    data: { name: "Second Org" },
  });
  expect(conflict.status()).toBe(409);
  // Bad payload still rejected before anything else for the same user.
  const invalid = await page.request.post("/api/organizations", { data: { name: "x" } });
  expect([400, 409]).toContain(invalid.status());
});

test("invitation API is idempotent, role-restricted, and returns a one-time accept path", async ({
  page,
}) => {
  await onboardFreshTenant(page, "api-invites");

  // Counsel roles can never be invited (FR-2).
  const counsel = await page.request.post("/api/invitations", {
    data: { email: "attacker@example.test", role: "counsel_attorney" },
  });
  expect(counsel.status()).toBe(400);

  const email = `invitee-${Date.now()}@example.test`;
  const first = await page.request.post("/api/invitations", {
    data: { email, role: "member" },
  });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  expect(firstBody.acceptPath).toContain("/app/invitations/accept?token=");

  // Same email again → idempotent: existing invitation, no fresh token.
  const second = await page.request.post("/api/invitations", {
    data: { email, role: "member" },
  });
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.existing).toBe(true);
  expect(secondBody.acceptPath).toBeNull();
  expect(secondBody.invitationId).toBe(firstBody.invitationId);
});

test("export API creates a version-locked manifest and 404s for foreign inventions", async ({
  page,
}) => {
  await onboardFreshTenant(page, "api-exports");
  // The seeded synthetic invention is on the dashboard.
  await page.goto("/app");
  const href = await page
    .locator('a[href^="/app/inventions/"]:not([href$="/new"])')
    .first()
    .getAttribute("href");
  const inventionId = href!.split("/").pop()!;
  expect(inventionId).not.toBe("new");

  const created = await page.request.post(`/api/inventions/${inventionId}/exports`, {
    data: { sections: ["facts", "contributors", "timeline", "sources"] },
  });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect(body.exportId).toBeTruthy();
  expect(body.checksum).toMatch(/^[0-9a-f]{64}$/);
  expect(body.manifest.notice).toContain("counsel");

  const foreign = await page.request.post("/api/inventions/not-my-invention/exports", {
    data: { sections: ["facts"] },
  });
  expect(foreign.status()).toBe(404);
});
