import { beforeEach, describe, expect, it } from "vitest";
import { representationStatus } from "@/lib/domain/counsel-request";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import type { CounselAssignmentRecord } from "@/lib/server/adapters/types";
import { createCounselRequest, performCounselAction } from "@/lib/server/services/counsel";
import {
  canAdvanceFilingPackage,
  createFilingPackageForMatter,
  getRequestForCounsel,
  listRequestsForCounsel,
  performCounselLaneAction,
} from "@/lib/server/services/counsel-lane";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const founder = await data.createUser({
    email: "founder@example.test",
    displayName: "Founder",
  });
  const org = await createOrganizationForUser(founder.id, "Lane Test Org");

  const intakeUser = await data.createUser({
    email: "counsel-intake@wepatent.local",
    displayName: "Intake Admin",
  });
  const attorneyUser = await data.createUser({
    email: "counsel-attorney@wepatent.local",
    displayName: "Attorney",
  });
  const intake: CounselAssignmentRecord = {
    userId: intakeUser.id,
    role: "counsel_intake",
    lawFirmName: "Schell IP (synthetic)",
    createdAt: new Date().toISOString(),
  };
  const attorney: CounselAssignmentRecord = {
    userId: attorneyUser.id,
    role: "counsel_attorney",
    lawFirmName: "Schell IP (synthetic)",
    createdAt: new Date().toISOString(),
  };
  await data.setCounselAssignment(intake);
  await data.setCounselAssignment(attorney);

  const created = await createCounselRequest({
    organizationId: org.id,
    userId: founder.id,
    input: {
      inventionId: null,
      requestSummary: "Patent strategy consultation for a synthetic cooling system.",
      adverseParties: "",
      jurisdiction: "Colorado, USA",
      contactEmail: "founder@example.test",
    },
  });
  if (!created.ok) throw new Error("request creation failed");
  return {
    data,
    founder,
    org,
    request: created.request,
    intakeUser,
    attorneyUser,
    intake,
    attorney,
  };
}

describe("connected-counsel administration lane (PRD §6.3)", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("hides draft requests from counsel entirely", async () => {
    const { request } = await setup();
    expect(await listRequestsForCounsel()).toHaveLength(0);
    expect(await getRequestForCounsel(request.id)).toBeNull();
  });

  it("walks the full lane: submit → conflict review → consultation → engagement → signed → matter", async () => {
    const { data, founder, org, request, intakeUser, attorneyUser, intake, attorney } =
      await setup();

    // Requester submits (ordinary role).
    const submitted = await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "submit",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    expect(submitted.ok).toBe(true);
    expect(await listRequestsForCounsel()).toHaveLength(1);
    expect(representationStatus("submitted").represented).toBe(false);

    // Intake begins conflict review; intake CANNOT accept or decline.
    const review = await performCounselLaneAction({
      requestId: request.id,
      action: "begin_conflict_review",
      counselUser: { id: intakeUser.id },
      assignment: intake,
    });
    expect(review.ok).toBe(true);
    const intakeDecline = await performCounselLaneAction({
      requestId: request.id,
      action: "decline",
      counselUser: { id: intakeUser.id },
      assignment: intake,
    });
    expect(intakeDecline).toEqual({ ok: false, error: "actor_not_allowed" });

    // Attorney offers consultation; requester schedules it.
    const offered = await performCounselLaneAction({
      requestId: request.id,
      action: "offer_consultation",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    expect(offered.ok).toBe(true);
    const scheduled = await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "schedule_consultation",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    expect(scheduled.ok).toBe(true);
    expect(representationStatus("consultation_scheduled").represented).toBe(false);

    // Engagement offer requires a scope; creates the engagement record.
    const noScope = await performCounselLaneAction({
      requestId: request.id,
      action: "offer_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    expect(noScope).toEqual({ ok: false, error: "scope_required" });
    const engagementOffer = await performCounselLaneAction({
      requestId: request.id,
      action: "offer_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
      scopeSummary: "Provisional application preparation for the cooling system.",
    });
    expect(engagementOffer.ok).toBe(true);
    const engagement = await data.getEngagementByRequest(request.id);
    expect(engagement?.signedAt).toBeNull();

    // Signed engagement requires evidence.
    const noEvidence = await performCounselLaneAction({
      requestId: request.id,
      action: "record_signed_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    expect(noEvidence).toEqual({ ok: false, error: "evidence_required" });
    const signed = await performCounselLaneAction({
      requestId: request.id,
      action: "record_signed_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
      evidenceRef: "engagement-letter-synthetic.pdf",
    });
    expect(signed.ok).toBe(true);
    const signedEngagement = await data.getEngagementByRequest(request.id);
    expect(signedEngagement?.signedDocumentRef).toBe("engagement-letter-synthetic.pdf");
    expect(representationStatus("engagement_signed").represented).toBe(true);

    // Conversion opens exactly one matter.
    const converted = await performCounselLaneAction({
      requestId: request.id,
      action: "convert_to_matter",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    expect(converted.ok).toBe(true);
    const matter = await data.getLegalMatterByEngagement(signedEngagement!.id);
    expect(matter).not.toBeNull();

    // Separate counsel audit trail recorded every lane action.
    const audit = await data.listCounselAuditEvents();
    const laneActions = audit.map((event) => event.action);
    expect(laneActions).toContain("counsel_lane.begin_conflict_review");
    expect(laneActions).toContain("counsel_lane.record_signed_engagement");
    expect(laneActions).toContain("counsel_lane.convert_to_matter");
  });

  it("cannot record a signed engagement before one is offered", async () => {
    const { org, founder, request, attorneyUser, attorney } = await setup();
    await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "submit",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    const result = await performCounselLaneAction({
      requestId: request.id,
      action: "record_signed_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
      evidenceRef: "premature.pdf",
    });
    expect(result).toEqual({ ok: false, error: "engagement_missing" });
  });

  it("ordinary organization roles can never perform counsel-side moves", async () => {
    const { org, founder, request } = await setup();
    await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "submit",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    const attempt = await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "begin_conflict_review",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    expect(attempt).toEqual({ ok: false, error: "actor_not_allowed" });
  });

  it("filing packages: attorney-only creation, staged statuses, no submission state", async () => {
    const { data, org, founder, request, intakeUser, attorneyUser, intake, attorney } =
      await setup();
    // Walk to matter quickly.
    await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "submit",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    await performCounselLaneAction({
      requestId: request.id,
      action: "begin_conflict_review",
      counselUser: { id: intakeUser.id },
      assignment: intake,
    });
    await performCounselLaneAction({
      requestId: request.id,
      action: "offer_consultation",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    await performCounselAction({
      organizationId: org.id,
      requestId: request.id,
      action: "schedule_consultation",
      actor: { kind: "user", role: "owner" },
      actorUserId: founder.id,
      actorRole: "owner",
    });
    await performCounselLaneAction({
      requestId: request.id,
      action: "offer_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
      scopeSummary: "Scope",
    });
    await performCounselLaneAction({
      requestId: request.id,
      action: "record_signed_engagement",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
      evidenceRef: "letter.pdf",
    });
    await performCounselLaneAction({
      requestId: request.id,
      action: "convert_to_matter",
      counselUser: { id: attorneyUser.id },
      assignment: attorney,
    });
    const engagement = await data.getEngagementByRequest(request.id);
    const matter = await data.getLegalMatterByEngagement(engagement!.id);

    const intakeAttempt = await createFilingPackageForMatter({
      matterId: matter!.id,
      description: "Provisional draft set",
      assignment: intake,
      counselUserId: intakeUser.id,
    });
    expect(intakeAttempt).toEqual({ ok: false, error: "actor_not_allowed" });

    const created = await createFilingPackageForMatter({
      matterId: matter!.id,
      description: "Provisional draft set",
      assignment: attorney,
      counselUserId: attorneyUser.id,
    });
    expect(created.ok).toBe(true);

    expect(canAdvanceFilingPackage("in_preparation", "counsel_review")).toBe(true);
    expect(canAdvanceFilingPackage("counsel_review", "counsel_approved")).toBe(true);
    expect(canAdvanceFilingPackage("in_preparation", "counsel_approved")).toBe(false);
    expect(canAdvanceFilingPackage("counsel_approved", "in_preparation")).toBe(false);
  });
});
