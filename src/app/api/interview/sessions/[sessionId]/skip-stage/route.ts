import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { requireApiOrgContext } from "@/lib/server/api";
import { skipInterviewStage } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/interview/sessions/:id/skip-stage (Intake Studio §6.2:
 * "stage advance requires that stage's minimum coverage or explicit user
 * skip"). Marks every remaining target of the current stage skipped and
 * advances — deterministic, zero model cost for the skip records.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { sessionId } = await context.params;
  const result = await skipInterviewStage({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    sessionId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "session_not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ view: result.view, warnings: result.warnings });
}
