import { NextResponse } from "next/server";
import { can } from "@/lib/domain/roles";
import { requireApiOrgContext } from "@/lib/server/api";
import { startPortalSession } from "@/lib/server/services/billing";

/**
 * POST /api/stripe/portal (PRD §10, FR-6): Stripe Customer Portal handoff.
 * Requires billing.manage. Local mode routes to the labeled simulated
 * portal; production requires a Stripe customer (created by first checkout).
 */
export async function POST(): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "billing.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await startPortalSession({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ url: result.url });
}
