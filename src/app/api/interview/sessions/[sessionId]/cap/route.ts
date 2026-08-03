import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { setSessionSpendCap } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

const bodySchema = z.object({ capCents: z.number().int().min(0).max(100_000) });

/**
 * POST /api/interview/sessions/:id/cap (FR-INT-10). Sets the session spend
 * cap — the explicit resume path after a cap halt: raising the cap
 * immediately re-drafts the pending question if headroom exists.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { sessionId } = await context.params;
  const result = await setSessionSpendCap({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    sessionId,
    capCents: body.data.capCents,
  });
  if (!result.ok) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  return NextResponse.json({ view: result.view, warnings: result.warnings ?? [] });
}
