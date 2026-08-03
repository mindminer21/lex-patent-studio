import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { requireApiOrgContext } from "@/lib/server/api";
import { startInterviewSession } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/inventions/:id/interview/sessions (Intake Studio §11,
 * FR-INT-6). Starts the adaptive interview for this record, or resumes the
 * caller's existing (active/paused) session — session state persists in
 * full (§6.1 pause/resume). Question drafting is a metered model step, so
 * this requires the drafting capability.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const result = await startInterviewSession({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    inventionId: id,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "invention_not_found" ? 404 : 500 },
    );
  }
  return NextResponse.json({ view: result.view, warnings: result.warnings });
}
