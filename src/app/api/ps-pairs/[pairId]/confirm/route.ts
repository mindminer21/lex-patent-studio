import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { requireApiOrgContext } from "@/lib/server/api";
import { confirmPair } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ pairId: string }> };

/**
 * POST /api/ps-pairs/:id/confirm — the ONLY path to user_confirmed, and it
 * requires an authenticated human session (invariant 13: AI can never set
 * a confirmed state; there is no model-facing route to this transition).
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { pairId } = await context.params;
  const result = await confirmPair({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    pairId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ pair: result.pair });
}
