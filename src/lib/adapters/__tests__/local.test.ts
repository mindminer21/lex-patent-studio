import { beforeEach, describe, expect, it } from "vitest";
import { localAdapters, resetLocalStore } from "@/lib/adapters/local";
import { ORG_ID } from "@/lib/adapters/local/seed";
import type { RunRequest } from "@/lib/domain/schemas";

const baseRequest: RunRequest = {
  matterId: "matter_thermal",
  workflowKey: "section_draft",
  jurisdiction: "US",
  asOfDate: "2026-08-01",
  modelId: "claude-sonnet-4-5",
  deliverableType: "Specification sections",
  qualityControls: {
    sourceRequired: true,
    secondModelReview: true,
    quoteVerification: true,
  },
  factIds: [],
  sourceIds: [],
};

describe("local data adapter (credential-free mode)", () => {
  beforeEach(resetLocalStore);

  it("serves the synthetic demo tenant", async () => {
    const matters = await localAdapters.data.listMatters(ORG_ID);
    expect(matters.length).toBeGreaterThanOrEqual(2);
    expect(matters.every((m) => m.synthetic)).toBe(true);
  });

  it("tenant scoping: another organizationId sees nothing", async () => {
    expect(await localAdapters.data.listMatters("org_other")).toEqual([]);
    expect(await localAdapters.data.listReviewItems("org_other")).toEqual([]);
    expect(
      await localAdapters.data.getMatter("org_other", "matter_thermal"),
    ).toBeNull();
  });

  it("createRun enforces server-side role policy (contributor refused)", async () => {
    const result = await localAdapters.data.createRun(ORG_ID, baseRequest, {
      requestedBy: "user_x",
      role: "contributor",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/may not invoke/);
  });

  it("createRun queues a run and writes an audit event for a practitioner", async () => {
    const result = await localAdapters.data.createRun(ORG_ID, baseRequest, {
      requestedBy: "user_demo_reyes",
      role: "practitioner_admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.state).toBe("QUEUED");
    expect(result.run.tier).toBe("B");
    expect(result.run.estimatedChargeHighUsd).toBeGreaterThan(
      result.run.estimatedChargeLowUsd,
    );

    const audit = await localAdapters.data.listAuditEvents(ORG_ID, { limit: 1 });
    expect(audit[0].action).toBe("run.create");
    expect(audit[0].subjectId).toBe(result.run.id);
  });

  it("review decisions are recorded to the audit log with actor + doc hash", async () => {
    const result = await localAdapters.data.decideReviewItem(
      ORG_ID,
      "rev_t_sections",
      "request_changes",
      { userId: "user_demo_reyes", role: "practitioner_admin", note: "Fix port count" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.state).toBe("changes_requested");
    expect(result.record.documentVersionHash).toBe(result.item.documentVersionHash);

    const audit = await localAdapters.data.listAuditEvents(ORG_ID, { limit: 1 });
    expect(audit[0].action).toBe("review.request_changes");
    expect(audit[0].detail).toContain(result.item.documentVersionHash);
  });

  it("an agent_operator cannot decide a Tier-B review item", async () => {
    const result = await localAdapters.data.decideReviewItem(
      ORG_ID,
      "rev_t_sections",
      "approve",
      { userId: "user_demo_ortiz", role: "agent_operator" },
    );
    expect(result.ok).toBe(false);
  });

  it("model gateway is never live in local mode", () => {
    expect(localAdapters.modelGateway.isLive()).toBe(false);
  });
});
