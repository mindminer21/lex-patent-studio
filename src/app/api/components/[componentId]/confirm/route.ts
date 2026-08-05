import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { requireApiOrgContext } from "@/lib/server/api";
import { confirmComponent } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ componentId: string }> };

/**
 * POST /api/components/:id/confirm — the ONLY path from `ai_proposed` to
 * `user_confirmed` for a component, and it requires an authenticated human
 * session (invariant 1: AI can never write a confirmed state).
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { componentId } = await context.params;
  const result = await confirmComponent({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    componentId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ component: result.component });
}
