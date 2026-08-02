import "server-only";

import { env } from "@/lib/env";
import { getAdapters } from "../adapters";
import type { Id } from "../adapters/types";
import { incrementCounter, logEvent, newCorrelationId } from "../observability";

/**
 * FR-2 break-glass support access: DISABLED BY DEFAULT and fully audited.
 *
 * - `platform_support` has zero standing grants (src/lib/domain/roles.ts).
 * - Access requires the operator to set BREAK_GLASS_ENABLED=1 on the server
 *   environment for the duration of the incident — there is no UI to enable
 *   it and no client-reachable toggle.
 * - Every invocation (including refused ones) is audit-logged with the
 *   support actor, target organization, and stated reason.
 * - Access is READ-ONLY metadata (record counts and ids), never invention
 *   content, and never a bypass of RLS in production (the service role is
 *   used the same way as ordinary trusted server logic).
 */
export type BreakGlassResult =
  | {
      ok: true;
      correlationId: string;
      snapshot: {
        organizationId: Id;
        organizationName: string;
        memberCount: number;
        inventionCount: number;
        jobCounts: Record<string, number>;
      };
    }
  | { ok: false; error: "disabled" | "not_found" };

export function isBreakGlassEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return source.BREAK_GLASS_ENABLED === "1";
}

export async function breakGlassOrgSnapshot(params: {
  supportUserId: Id;
  organizationId: Id;
  reason: string;
  envSource?: NodeJS.ProcessEnv;
}): Promise<BreakGlassResult> {
  const correlationId = newCorrelationId();
  const { data } = getAdapters();

  if (!isBreakGlassEnabled(params.envSource)) {
    incrementCounter("break_glass.refused");
    // Refusals are audited too: attempted use of support access matters.
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: `support:${params.supportUserId}`,
      action: "break_glass.refused_disabled",
      target: params.organizationId,
      meta: { reason: params.reason.slice(0, 200) },
    });
    logEvent({
      level: "warn",
      event: "break_glass.refused",
      correlationId,
      meta: { supportUserId: params.supportUserId },
    });
    return { ok: false, error: "disabled" };
  }

  const organization = await data.getOrganizationById(params.organizationId);
  if (!organization) return { ok: false, error: "not_found" };

  const memberships = await data.getMembershipsForOrganization(params.organizationId);
  const inventions = await data.listInventions(params.organizationId);
  const jobs = await data.listJobs(params.organizationId);
  const jobCounts: Record<string, number> = {};
  for (const job of jobs) {
    jobCounts[job.status] = (jobCounts[job.status] ?? 0) + 1;
  }

  incrementCounter("break_glass.used");
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `support:${params.supportUserId}`,
    action: "break_glass.org_snapshot",
    target: params.organizationId,
    meta: { reason: params.reason.slice(0, 200), appMode: env.APP_MODE },
  });
  logEvent({
    level: "warn",
    event: "break_glass.used",
    correlationId,
    meta: { supportUserId: params.supportUserId, organizationId: params.organizationId },
  });

  return {
    ok: true,
    correlationId,
    snapshot: {
      organizationId: organization.id,
      organizationName: organization.name,
      memberCount: memberships.length,
      inventionCount: inventions.length,
      jobCounts,
    },
  };
}
