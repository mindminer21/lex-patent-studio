"use server";

import { redirect } from "next/navigation";
import {
  COUNSEL_REQUEST_ACTIONS,
  type CounselRequestAction,
} from "@/lib/domain/counsel-request";
import { getAdapters } from "@/lib/server/adapters";
import {
  canAdvanceFilingPackage,
  createFilingPackageForMatter,
  performCounselLaneAction,
} from "@/lib/server/services/counsel-lane";
import { requireCounsel } from "@/lib/server/session";

/**
 * Counsel-lane transitions run with the signed-in counsel user's REAL
 * assignment role — the same domain guards as everywhere else. An intake
 * administrator attempting an attorney-only step is rejected by the state
 * machine, not by UI hiding alone.
 */
export async function counselLaneAction(formData: FormData): Promise<void> {
  const context = await requireCounsel();
  const requestId = String(formData.get("requestId") ?? "");
  const action = String(formData.get("action") ?? "") as CounselRequestAction;
  const evidenceRef = String(formData.get("evidenceRef") ?? "").trim() || undefined;
  const scopeSummary = String(formData.get("scopeSummary") ?? "").trim() || undefined;
  if (!COUNSEL_REQUEST_ACTIONS.includes(action)) {
    redirect(`/counsel/requests/${requestId}?error=unknown_action`);
  }
  const result = await performCounselLaneAction({
    requestId,
    action,
    counselUser: { id: context.user.id },
    assignment: context.assignment,
    evidenceRef,
    scopeSummary,
  });
  redirect(`/counsel/requests/${requestId}${result.ok ? "" : `?error=${result.error}`}`);
}

export async function createFilingPackageAction(formData: FormData): Promise<void> {
  const context = await requireCounsel();
  const matterId = String(formData.get("matterId") ?? "");
  const description = String(formData.get("description") ?? "");
  const result = await createFilingPackageForMatter({
    matterId,
    description,
    assignment: context.assignment,
    counselUserId: context.user.id,
  });
  redirect(
    `/counsel/matters/${matterId}/filing-package${result.ok ? "" : `?error=${result.error}`}`,
  );
}

const PACKAGE_STATUSES = ["in_preparation", "counsel_review", "counsel_approved"] as const;
type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export async function advanceFilingPackageAction(formData: FormData): Promise<void> {
  const context = await requireCounsel();
  const matterId = String(formData.get("matterId") ?? "");
  const packageId = String(formData.get("packageId") ?? "");
  const to = String(formData.get("to") ?? "") as PackageStatus;
  const back = `/counsel/matters/${matterId}/filing-package`;

  if (context.assignment.role !== "counsel_attorney") {
    redirect(`${back}?error=actor_not_allowed`);
  }
  if (!PACKAGE_STATUSES.includes(to)) redirect(`${back}?error=invalid_input`);

  const { data } = getAdapters();
  const matter = await data.getLegalMatter(matterId);
  if (!matter) redirect(`${back}?error=not_found`);
  const packages = await data.listFilingPackages(matterId);
  const filingPackage = packages.find((entry) => entry.id === packageId);
  if (!filingPackage) redirect(`${back}?error=not_found`);
  if (!canAdvanceFilingPackage(filingPackage!.status, to)) {
    redirect(`${back}?error=invalid_from_state`);
  }
  await data.updateFilingPackageStatus(packageId, to);
  await data.appendCounselAuditEvent({
    counselUserId: context.user.id,
    organizationId: matter!.organizationId,
    requestId: null,
    action: "counsel_lane.filing_package_advanced",
    meta: { packageId, to },
  });
  redirect(back);
}
