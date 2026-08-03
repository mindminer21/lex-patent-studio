import { NextResponse } from "next/server";
import { requireApiOrgContext } from "@/lib/server/api";
import { getInterviewView, pauseInterviewSession } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/interview/sessions/:id/pause (Intake Studio §6.1). Pauses the
 * session with full state persistence; POST /inventions/:id/interview/
 * sessions resumes it later exactly where it left off.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { sessionId } = await context.params;
  const result = await pauseInterviewSession({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    sessionId,
  });
  if (!result.ok) return NextResponse.json({ error: "not_pausable" }, { status: 409 });
  const view = await getInterviewView(auth.context.organization.id, sessionId);
  return NextResponse.json({ view });
}
