import { beforeEach, describe, expect, it } from "vitest";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import {
  defaultOrganizationName,
  ensurePersonalOrganization,
  FALLBACK_ORGANIZATION_NAME,
  updateOrganizationName,
} from "@/lib/server/services/orgs";

/**
 * Friction audit candidate 5: the blocking "Create your organization" step
 * is replaced by idempotent auto-creation on first sign-in with a
 * placeholder name. This is a UX change only — the tests below assert the
 * tenancy model is untouched (owner membership, default retention, wallet +
 * promo ledger entry, seeded synthetic record, `organization.created`
 * audit event) and that repeated calls never create a second organization.
 */

describe("placeholder organization naming", () => {
  it("derives a human name from the email local-part", () => {
    expect(defaultOrganizationName("jeff@mndmnr.com")).toBe("Jeff's workspace");
    expect(defaultOrganizationName("ada.lovelace@example.test")).toBe(
      "Ada Lovelace's workspace",
    );
    expect(defaultOrganizationName("casey_synthetic@example.test")).toBe(
      "Casey Synthetic's workspace",
    );
  });

  it("drops purely numeric segments so unique test/signup addresses stay readable", () => {
    expect(defaultOrganizationName("founder-1754300000@example.test")).toBe(
      "Founder's workspace",
    );
    expect(defaultOrganizationName("a+12345@example.test")).toBe("A's workspace");
  });

  it("falls back to a generic name when nothing human remains", () => {
    expect(defaultOrganizationName("12345@example.test")).toBe(FALLBACK_ORGANIZATION_NAME);
    expect(defaultOrganizationName("@example.test")).toBe(FALLBACK_ORGANIZATION_NAME);
    // Always inside the 2–120 DB bound.
    const long = `${"segment.".repeat(40)}x@example.test`;
    const name = defaultOrganizationName(long);
    expect(name.length).toBeGreaterThanOrEqual(2);
    expect(name.length).toBeLessThanOrEqual(120);
  });
});

describe("automatic first-organization creation (idempotent)", () => {
  beforeEach(() => {
    LocalDataAdapter.reset();
  });

  it("creates the organization with the identical transactional side effects", async () => {
    const { data } = getAdapters();
    const user = await data.createUser({ email: "ada@example.test", displayName: "Ada" });

    const organization = await ensurePersonalOrganization(user);
    expect(organization).not.toBeNull();
    expect(organization!.name).toBe("Ada's workspace");
    // Default retention window is unchanged by auto-creation.
    expect(organization!.retentionDays).toBeGreaterThanOrEqual(30);

    const memberships = await data.getMembershipsForUser(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("owner");

    const wallet = await data.getWallet(organization!.id);
    expect(wallet?.balanceCents).toBe(2_500);
    const ledger = await data.listLedgerEntries(organization!.id);
    expect(ledger.map((entry) => entry.kind)).toContain("promo_credit");

    // Seeded synthetic record and the creation audit event are identical to
    // the old "Create organization" button path.
    const inventions = await data.listInventions(organization!.id);
    expect(inventions.some((invention) => invention.synthetic)).toBe(true);
    const audit = await data.listAuditEvents(organization!.id);
    expect(audit.some((event) => event.action === "organization.created")).toBe(true);
  });

  it("is idempotent — repeated sign-ins never create a second organization", async () => {
    const { data } = getAdapters();
    const user = await data.createUser({ email: "repeat@example.test", displayName: "Repeat" });

    const first = await ensurePersonalOrganization(user);
    const second = await ensurePersonalOrganization(user);
    const third = await ensurePersonalOrganization(user);

    expect(second!.id).toBe(first!.id);
    expect(third!.id).toBe(first!.id);
    expect(await data.getMembershipsForUser(user.id)).toHaveLength(1);
    const audit = await data.listAuditEvents(first!.id);
    expect(audit.filter((event) => event.action === "organization.created")).toHaveLength(1);
  });

  it("never overrides an existing membership (e.g. an accepted invitation)", async () => {
    const { data } = getAdapters();
    const owner = await data.createUser({ email: "owner@example.test", displayName: "Owner" });
    const org = await ensurePersonalOrganization(owner);

    const invitee = await data.createUser({ email: "invitee@example.test", displayName: "In" });
    await data.createMembership({
      organizationId: org!.id,
      userId: invitee.id,
      role: "member",
    });

    const resolved = await ensurePersonalOrganization(invitee);
    expect(resolved!.id).toBe(org!.id);
    expect(await data.listInventions(org!.id)).toHaveLength(1); // no second seed
  });
});

describe("organization rename (Settings autosave)", () => {
  beforeEach(() => {
    LocalDataAdapter.reset();
  });

  it("is owner-gated, bounds-checked, and audited", async () => {
    const { data } = getAdapters();
    const user = await data.createUser({ email: "rename@example.test", displayName: "R" });
    const organization = (await ensurePersonalOrganization(user))!;

    expect(
      await updateOrganizationName({
        organizationId: organization.id,
        actorUserId: user.id,
        actorRole: "member",
        name: "Nope",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      await updateOrganizationName({
        organizationId: organization.id,
        actorUserId: user.id,
        actorRole: "owner",
        name: "x",
      }),
    ).toEqual({ ok: false, error: "invalid_input" });

    const ok = await updateOrganizationName({
      organizationId: organization.id,
      actorUserId: user.id,
      actorRole: "owner",
      name: "  Bright Idea Labs  ",
    });
    expect(ok).toEqual({ ok: true, name: "Bright Idea Labs" });
    expect((await data.getOrganizationById(organization.id))?.name).toBe("Bright Idea Labs");

    const audit = await data.listAuditEvents(organization.id);
    expect(audit.some((event) => event.action === "organization.renamed")).toBe(true);
  });
});
