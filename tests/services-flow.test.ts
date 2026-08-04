import { beforeEach, describe, expect, it } from "vitest";
import {
  completeStage,
  emptyIntakeState,
  INTAKE_STAGE_KEYS,
  type IntakeState,
} from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { submitIntake, updateFactProvenance } from "@/lib/server/services/inventions";
import { runGeneration } from "@/lib/server/services/generation";
import { createExport } from "@/lib/server/services/exports";
import {
  createCounselRequest,
  performCounselAction,
} from "@/lib/server/services/counsel";

const stageData: Record<string, unknown> = {
  identity: {
    title: "Flow test invention",
    summary: "An integration-test invention record with enough summary text.",
    businessContext: "",
  },
  problem_solution: {
    problem: "The integration problem statement is long enough.",
    solution: "The integration solution statement is long enough.",
  },
  components: { components: [{ name: "Core", description: "central piece" }], steps: [], alternatives: "", advantages: "" },
  contributors: { contributors: [{ name: "Flow Tester", contribution: "everything" }] },
  timeline: { events: [], noEventsConfirmed: true },
  ownership: {
    employmentAgreementsExist: "yes",
    assignmentsExecuted: "no",
    thirdPartyObligations: "",
    openQuestions: "",
  },
  sources: { sources: [], noSourcesConfirmed: true },
  review: { confirmAccuracy: true },
};

function completedIntake(): IntakeState {
  let state = emptyIntakeState();
  for (const key of INTAKE_STAGE_KEYS) {
    const result = completeStage(state, key, stageData[key]);
    if (!result.ok) throw new Error(`stage ${key} failed`);
    state = result.state;
  }
  return state;
}

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "flow@example.test", displayName: "Flow" });
  const org = await createOrganizationForUser(user.id, "Flow Test Org");
  return { data, user, org };
}

describe("service-level integration flow (local adapters, synthetic data)", () => {
  beforeEach(() => {
    LocalDataAdapter.reset();
  });

  it("org creation seeds a synthetic invention, wallet credit, and audit trail", async () => {
    const { data, org } = await setup();
    const inventions = await data.listInventions(org.id);
    expect(inventions).toHaveLength(1);
    expect(inventions[0].synthetic).toBe(true);
    expect(inventions[0].title).toContain("SYNTHETIC");
    const wallet = await data.getWallet(org.id);
    expect(wallet?.balanceCents).toBe(2500);
    const ledger = await data.listLedgerEntries(org.id);
    expect(ledger[0].kind).toBe("promo_credit");
  });

  it("intake submission creates the invention with user-asserted and unresolved facts", async () => {
    const { data, user, org } = await setup();
    const result = await submitIntake({
      organizationId: org.id,
      userId: user.id,
      intake: completedIntake(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = await data.listFacts(org.id, result.invention.id);
    expect(facts.length).toBeGreaterThan(0);
    // assignmentsExecuted = "no" → ownership fact recorded as unresolved.
    const ownership = facts.filter((f) => f.category === "ownership");
    expect(ownership[0].provenance).toBe("needs_confirmation");
    expect(facts.every((f) => f.createdBy === "user")).toBe(true);
  });

  it("incomplete intake cannot be submitted", async () => {
    const { user, org } = await setup();
    const result = await submitIntake({
      organizationId: org.id,
      userId: user.id,
      intake: emptyIntakeState(),
    });
    expect(result).toEqual({ ok: false, error: "incomplete_intake" });
  });

  it("generation reserves, generates a labeled working draft, and settles at the generation multiplier", async () => {
    const { data, user, org } = await setup();
    const [invention] = await data.listInventions(org.id);
    const before = await data.getWallet(org.id);
    const result = await runGeneration({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "invention_disclosure_summary",
      tierId: "standard",
      idempotencyKey: "gen-key-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version.label).toBe("working_draft");
    expect(result.version.content).toContain("WORKING DRAFT — COUNSEL REVIEW REQUIRED");
    expect(result.version.modelId).toBe("wepatent-local-standard");

    const events = await data.listUsageEvents(org.id);
    expect(events).toHaveLength(1);
    // Drafting the disclosure summary authors work product delivered to the
    // customer, so it is a GENERATION task and bills at 2.0 (Jeff's
    // directive, 2026-08-04). Analysis-category services still bill at 1.5.
    expect(events[0].customerChargeCents).toBe(
      Math.ceil(events[0].providerCostCents * 2.0),
    );
    const after = await data.getWallet(org.id);
    expect(after?.balanceCents).toBe((before?.balanceCents ?? 0) - events[0].customerChargeCents);
    expect(after?.reservedCents).toBe(0);

    // Facts were not touched by the model output.
    const facts = await data.listFacts(org.id, invention.id);
    expect(facts.every((f) => f.createdBy !== "model")).toBe(true);
  });

  it("a retry with the same idempotency key does not double-charge", async () => {
    const { data, user, org } = await setup();
    const [invention] = await data.listInventions(org.id);
    const params = {
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "gap_analysis" as const,
      tierId: "standard",
      idempotencyKey: "same-key",
    };
    const first = await runGeneration(params);
    expect(first.ok).toBe(true);
    const walletAfterFirst = await data.getWallet(org.id);
    const second = await runGeneration(params);
    expect(second.ok).toBe(true);
    const walletAfterSecond = await data.getWallet(org.id);
    expect(walletAfterSecond?.balanceCents).toBe(walletAfterFirst?.balanceCents);
    const events = await data.listUsageEvents(org.id);
    expect(events).toHaveLength(1);
  });

  it("generation with an insufficient wallet never starts", async () => {
    const { data, user, org } = await setup();
    const [invention] = await data.listInventions(org.id);
    await data.saveWallet({ organizationId: org.id, balanceCents: 1, reservedCents: 0 });
    const result = await runGeneration({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "invention_disclosure_summary",
      tierId: "advanced",
      idempotencyKey: "broke-key",
    });
    expect(result).toEqual({ ok: false, error: "insufficient_funds" });
    expect(await data.listUsageEvents(org.id)).toHaveLength(0);
    expect(await data.listDrafts(org.id, invention.id)).toHaveLength(0);
  });

  it("cross-tenant access is denied at the adapter boundary", async () => {
    const { data, user, org } = await setup();
    const otherUser = await data.createUser({ email: "other@example.test", displayName: "Other" });
    const otherOrg = await createOrganizationForUser(otherUser.id, "Other Org");
    const [invention] = await data.listInventions(org.id);
    expect(await data.getInvention(otherOrg.id, invention.id)).toBeNull();
    const result = await runGeneration({
      organizationId: otherOrg.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "gap_analysis",
      tierId: "standard",
      idempotencyKey: "cross-tenant",
    });
    expect(result).toEqual({ ok: false, error: "invention_not_found" });
  });

  it("counsel request creation accepts an omitted inventionId (API path)", async () => {
    const { user, org } = await setup();
    // With the in-app intake form removed, requests arrive via the API and
    // may omit the optional invention reference entirely ("None / general").
    const created = await createCounselRequest({
      organizationId: org.id,
      userId: user.id,
      input: {
        requestSummary: "Consultation about protecting our synthetic separator design.",
        jurisdiction: "Colorado, USA",
        contactEmail: "flow@example.test",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.request.inventionId).toBeNull();
    expect(created.request.state).toBe("draft");
  });

  it("counsel request flow enforces role guards end to end", async () => {
    const { user, org } = await setup();
    const created = await createCounselRequest({
      organizationId: org.id,
      userId: user.id,
      input: {
        inventionId: null,
        requestSummary: "Discuss patent strategy for our cooling system.",
        adverseParties: "",
        jurisdiction: "Colorado, US",
        contactEmail: "flow@example.test",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const requestId = created.request.id;

    // Requester cannot begin conflict review.
    const notAllowed = await performCounselAction({
      organizationId: org.id,
      requestId,
      action: "begin_conflict_review",
      actor: { kind: "user", role: "owner" },
      actorUserId: user.id,
      actorRole: "owner",
    });
    expect(notAllowed).toEqual({ ok: false, error: "invalid_from_state" });

    // Submit (requester), then walk counsel-side with counsel roles.
    const submitted = await performCounselAction({
      organizationId: org.id,
      requestId,
      action: "submit",
      actor: { kind: "user", role: "owner" },
      actorUserId: user.id,
      actorRole: "owner",
    });
    expect(submitted.ok).toBe(true);

    const ownerTriesReview = await performCounselAction({
      organizationId: org.id,
      requestId,
      action: "begin_conflict_review",
      actor: { kind: "user", role: "owner" },
      actorUserId: user.id,
      actorRole: "owner",
    });
    expect(ownerTriesReview).toEqual({ ok: false, error: "actor_not_allowed" });

    const review = await performCounselAction({
      organizationId: org.id,
      requestId,
      action: "begin_conflict_review",
      actor: { kind: "user", role: "counsel_intake" },
      actorUserId: "counsel-1",
      actorRole: "counsel_intake",
    });
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.request.state).toBe("conflict_review");
  });

  it("fact provenance service rejects model actors and counsel_reviewed from users", async () => {
    const { data, user, org } = await setup();
    const [invention] = await data.listInventions(org.id);
    const [fact] = await data.listFacts(org.id, invention.id);

    const asModel = await updateFactProvenance({
      organizationId: org.id,
      factId: fact.id,
      actor: "model",
      to: "source_supported",
      actorUserId: "model",
    });
    expect(asModel).toEqual({ ok: false, error: "actor_not_allowed" });

    const asUserToReviewed = await updateFactProvenance({
      organizationId: org.id,
      factId: fact.id,
      actor: "user",
      to: "counsel_reviewed",
      actorUserId: user.id,
    });
    expect(asUserToReviewed).toEqual({ ok: false, error: "actor_not_allowed" });
  });

  it("exports are version-locked with checksum and counsel notice", async () => {
    const { data, user, org } = await setup();
    const [invention] = await data.listInventions(org.id);
    const generated = await runGeneration({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "counsel_question_list",
      tierId: "standard",
      idempotencyKey: "export-gen",
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const exported = await createExport({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      draftVersionId: generated.version.id,
      sections: ["facts", "contributors"],
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.record.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(exported.record.manifest.notice).toContain("Not legal advice");
    expect(exported.record.manifest.draftVersionId).toBe(generated.version.id);
    expect(exported.record.manifest.draftLabel).toContain("counsel review required");

    // Later record changes do not alter the stored export.
    await data.createFact({
      organizationId: org.id,
      inventionId: invention.id,
      category: "technical",
      statement: "A fact added after the export was created.",
      provenance: "user_asserted",
      createdBy: "user",
    });
    const exportsAfter = await data.listExports(org.id, invention.id);
    expect(exportsAfter[0].manifest.factCount).toBe(exported.record.manifest.factCount);
    expect(exportsAfter[0].checksum).toBe(exported.record.checksum);
  });
});
