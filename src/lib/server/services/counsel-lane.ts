import "server-only";

import type { CounselRequestAction } from "@/lib/wepatent/domain/counsel-request";
import { getAdapters } from "../adapters";
import { performCounselAction } from "./counsel";
import type {
  CounselAssignmentRecord,
  CounselRequestRecord,
  EngagementRecord,
  FilingPackageRecord,
  Id,
  LegalMatterRecord,
} from "../adapters/types";

/**
 * Connected-counsel administration lane (PRD §6.3, §7.6).
 *
 * - Only counsel-role callers reach these functions (requireCounsel at the
 *   route boundary); the domain state machine re-checks the acting role on
 *   every transition, so an intake administrator still cannot decline or
 *   accept a request.
 * - The lane sees the LIMITED conflict-intake fields only. No invention
 *   record content crosses this boundary before an engagement permits it.
 * - Every action lands in the separate counsel audit trail in addition to
 *   the tenant's own request-event history.
 * - counsel_request !== engagement: representation exists only when a
 *   signed engagement document reference is recorded, and even then only as
 *   defined by that engagement letter.
 */

/** Draft requests are invisible to counsel — nothing is shared before submission. */
export async function listRequestsForCounsel(): Promise<CounselRequestRecord[]> {
  const { data } = getAdapters();
  const all = await data.listCounselRequestsAllOrgs();
  return all.filter((request) => request.state !== "draft");
}

export async function getRequestForCounsel(
  requestId: Id,
): Promise<CounselRequestRecord | null> {
  const { data } = getAdapters();
  const request = await data.getCounselRequestAnyOrg(requestId);
  if (!request || request.state === "draft") return null;
  return request;
}

export type CounselLaneActionResult =
  | { ok: true; request: CounselRequestRecord }
  | {
      ok: false;
      error:
        | "not_found"
        | "unknown_action"
        | "invalid_from_state"
        | "actor_not_allowed"
        | "evidence_required"
        | "engagement_missing"
        | "scope_required";
    };

/**
 * Applies a counsel-side transition with the caller's real counsel role and
 * performs the lane's record side effects:
 * - offer_engagement creates the engagement record (scope required);
 * - record_signed_engagement stores the signed-document reference on the
 *   existing engagement (evidence required — mirrors the DB trigger);
 * - convert_to_matter opens the legal matter.
 */
export async function performCounselLaneAction(params: {
  requestId: Id;
  action: CounselRequestAction;
  counselUser: { id: Id };
  assignment: CounselAssignmentRecord;
  evidenceRef?: string;
  scopeSummary?: string;
}): Promise<CounselLaneActionResult> {
  const { data } = getAdapters();
  const request = await getRequestForCounsel(params.requestId);
  if (!request) return { ok: false, error: "not_found" };

  if (params.action === "offer_engagement" && !params.scopeSummary?.trim()) {
    return { ok: false, error: "scope_required" };
  }
  if (params.action === "record_signed_engagement") {
    const engagement = await data.getEngagementByRequest(request.id);
    if (!engagement) return { ok: false, error: "engagement_missing" };
  }

  const result = await performCounselAction({
    organizationId: request.organizationId,
    requestId: request.id,
    action: params.action,
    actor: { kind: "user", role: params.assignment.role },
    actorUserId: params.counselUser.id,
    actorRole: params.assignment.role,
    evidenceRef: params.evidenceRef,
  });
  if (!result.ok) return result;

  if (params.action === "offer_engagement") {
    await data.createEngagement({
      organizationId: request.organizationId,
      requestId: request.id,
      lawFirmName: params.assignment.lawFirmName,
      scopeSummary: params.scopeSummary!.trim(),
      signedDocumentRef: null,
      signedAt: null,
    });
  }
  if (params.action === "record_signed_engagement") {
    const engagement = await data.getEngagementByRequest(request.id);
    if (engagement) {
      await data.updateEngagement(engagement.id, {
        signedDocumentRef: params.evidenceRef ?? null,
        signedAt: new Date().toISOString(),
      });
    }
  }
  if (params.action === "convert_to_matter") {
    const engagement = await data.getEngagementByRequest(request.id);
    if (engagement) {
      const existing = await data.getLegalMatterByEngagement(engagement.id);
      if (!existing) {
        await data.createLegalMatter({
          organizationId: request.organizationId,
          engagementId: engagement.id,
          matterReference: `M-${new Date().getFullYear()}-${request.id.slice(0, 8)}`,
        });
      }
    }
  }

  await data.appendCounselAuditEvent({
    counselUserId: params.counselUser.id,
    organizationId: request.organizationId,
    requestId: request.id,
    action: `counsel_lane.${params.action}`,
    meta: {
      role: params.assignment.role,
      evidenceRef: params.evidenceRef ?? null,
    },
  });

  return { ok: true, request: result.request };
}

/* ------------------------------------------------------------------ */
/* Filing packages (PRD §6.3, §5.5): preparation states only. There is */
/* no "submitted" state — authenticated filing stays under attorney    */
/* control outside this system; wepatent never files.                  */
/* ------------------------------------------------------------------ */

const FILING_PACKAGE_FLOW: Record<
  FilingPackageRecord["status"],
  readonly FilingPackageRecord["status"][]
> = {
  in_preparation: ["counsel_review"],
  counsel_review: ["counsel_approved", "in_preparation"],
  counsel_approved: [],
};

export async function createFilingPackageForMatter(params: {
  matterId: Id;
  description: string;
  assignment: CounselAssignmentRecord;
  counselUserId: Id;
}): Promise<
  | { ok: true; filingPackage: FilingPackageRecord; matter: LegalMatterRecord }
  | { ok: false; error: "not_found" | "actor_not_allowed" | "invalid_input" }
> {
  if (params.assignment.role !== "counsel_attorney") {
    return { ok: false, error: "actor_not_allowed" };
  }
  const description = params.description.trim();
  if (description.length < 3 || description.length > 2_000) {
    return { ok: false, error: "invalid_input" };
  }
  const { data } = getAdapters();
  const matter = await data.getLegalMatter(params.matterId);
  if (!matter) return { ok: false, error: "not_found" };
  const filingPackage = await data.createFilingPackage({
    organizationId: matter.organizationId,
    matterId: matter.id,
    description,
    status: "in_preparation",
  });
  await data.appendCounselAuditEvent({
    counselUserId: params.counselUserId,
    organizationId: matter.organizationId,
    requestId: null,
    action: "counsel_lane.filing_package_created",
    meta: { matterId: matter.id },
  });
  return { ok: true, filingPackage, matter };
}

export function canAdvanceFilingPackage(
  from: FilingPackageRecord["status"],
  to: FilingPackageRecord["status"],
): boolean {
  return FILING_PACKAGE_FLOW[from].includes(to);
}

export async function getEngagementView(engagementId: Id): Promise<{
  engagement: EngagementRecord;
  request: CounselRequestRecord | null;
  matter: LegalMatterRecord | null;
} | null> {
  const { data } = getAdapters();
  const engagement = await data.getEngagement(engagementId);
  if (!engagement) return null;
  const request = await data.getCounselRequestAnyOrg(engagement.requestId);
  const matter = await data.getLegalMatterByEngagement(engagement.id);
  return { engagement, request, matter };
}
