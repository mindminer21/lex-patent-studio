import { beforeEach, describe, expect, it } from "vitest";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { breakGlassOrgSnapshot } from "@/lib/server/services/break-glass";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import {
  isPurgeEligible,
  runRetentionPurge,
  updateRetentionPolicy,
} from "@/lib/server/services/retention";

/** FR-3 retention purge + FR-2 break-glass tests. */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retention policy and purge (FR-3)", () => {
  let organizationId = "";
  let ownerId = "";

  beforeEach(async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const owner = await data.createUser({ email: "owner@r.test", displayName: "Owner" });
    ownerId = owner.id;
    const org = await createOrganizationForUser(owner.id, "Retention Org");
    organizationId = org.id;
  });

  it("owner can update retention within the DB bounds; others cannot", async () => {
    const ok = await updateRetentionPolicy({
      organizationId,
      actorUserId: ownerId,
      actorRole: "owner",
      retentionDays: 90,
    });
    expect(ok).toEqual({ ok: true, retentionDays: 90 });
    const { data } = getAdapters();
    expect((await data.getOrganizationById(organizationId))?.retentionDays).toBe(90);

    expect(
      await updateRetentionPolicy({
        organizationId,
        actorUserId: ownerId,
        actorRole: "member",
        retentionDays: 120,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await updateRetentionPolicy({
        organizationId,
        actorUserId: ownerId,
        actorRole: "owner",
        retentionDays: 5, // below the 30-day floor (DB check constraint)
      }),
    ).toEqual({ ok: false, error: "invalid_input" });
  });

  it("purge eligibility respects status and window", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const old = new Date(now.getTime() - 400 * DAY_MS).toISOString();
    const recent = new Date(now.getTime() - 10 * DAY_MS).toISOString();
    expect(isPurgeEligible({ status: "soft_deleted", updatedAt: old }, 365, now)).toBe(true);
    expect(isPurgeEligible({ status: "soft_deleted", updatedAt: recent }, 365, now)).toBe(false);
    expect(isPurgeEligible({ status: "active", updatedAt: old }, 365, now)).toBe(false);
  });

  it("purges eligible soft-deleted records with all content, keeps audit evidence", async () => {
    const { data } = getAdapters();
    const [invention] = await data.listInventions(organizationId);
    expect(invention).toBeTruthy();
    const factsBefore = await data.listFacts(organizationId, invention.id);
    expect(factsBefore.length).toBeGreaterThan(0);

    await data.softDeleteInvention(organizationId, invention.id);

    // Inside the window: nothing purged.
    const early = await runRetentionPurge({
      organizationId,
      actorUserId: ownerId,
      actorRole: "owner",
    });
    expect(early).toEqual({ ok: true, purged: 0, pending: 1 });

    // After the window: purged with evidence.
    const later = new Date(Date.now() + 366 * DAY_MS);
    const result = await runRetentionPurge({
      organizationId,
      actorUserId: ownerId,
      actorRole: "owner",
      now: later,
    });
    expect(result).toEqual({ ok: true, purged: 1, pending: 0 });

    expect(await data.getInvention(organizationId, invention.id)).toBeNull();
    expect(await data.listFacts(organizationId, invention.id)).toHaveLength(0);
    expect(await data.listSources(organizationId, invention.id)).toHaveLength(0);
    expect(await data.listSoftDeletedInventions(organizationId)).toHaveLength(0);

    const audit = await data.listAuditEvents(organizationId);
    const purgeEvent = audit.find((event) => event.action === "retention.invention_purged");
    expect(purgeEvent).toBeTruthy();
    expect(purgeEvent!.target).toBe(invention.id);
    // Evidence carries counts only — no invention content.
    expect(JSON.stringify(purgeEvent!.meta)).not.toContain(invention.title);
  });

  it("viewers cannot run the purge", async () => {
    expect(
      await runRetentionPurge({ organizationId, actorUserId: ownerId, actorRole: "viewer" }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("break-glass support access (FR-2)", () => {
  let organizationId = "";

  beforeEach(async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const owner = await data.createUser({ email: "bg@r.test", displayName: "BG" });
    const org = await createOrganizationForUser(owner.id, "BreakGlass Org");
    organizationId = org.id;
  });

  it("is disabled by default and audits the refused attempt", async () => {
    const result = await breakGlassOrgSnapshot({
      supportUserId: "support-1",
      organizationId,
      reason: "customer reported stuck job",
      envSource: {} as unknown as NodeJS.ProcessEnv,
    });
    expect(result).toEqual({ ok: false, error: "disabled" });
    const { data } = getAdapters();
    const audit = await data.listAuditEvents(organizationId);
    expect(audit.some((event) => event.action === "break_glass.refused_disabled")).toBe(true);
  });

  it("when explicitly enabled, returns metadata only and fully audits the access", async () => {
    const result = await breakGlassOrgSnapshot({
      supportUserId: "support-1",
      organizationId,
      reason: "incident 42",
      envSource: { BREAK_GLASS_ENABLED: "1" } as unknown as NodeJS.ProcessEnv,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.organizationId).toBe(organizationId);
    expect(result.snapshot.memberCount).toBe(1);
    // Metadata only: the snapshot never includes fact statements or content.
    expect(JSON.stringify(result.snapshot)).not.toContain("summary");
    const { data } = getAdapters();
    const audit = await data.listAuditEvents(organizationId);
    const used = audit.find((event) => event.action === "break_glass.org_snapshot");
    expect(used).toBeTruthy();
    expect(used!.actor).toBe("support:support-1");
    expect(used!.meta.reason).toBe("incident 42");
  });

  it("platform_support has zero standing grants", async () => {
    const { can } = await import("@/lib/wepatent/domain/roles");
    const { ACTIONS } = await import("@/lib/wepatent/domain/roles");
    for (const action of ACTIONS) {
      expect(can("platform_support", action)).toBe(false);
    }
  });
});
