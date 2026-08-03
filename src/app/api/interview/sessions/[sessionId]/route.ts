import { NextResponse } from "next/server";
import { requireApiOrgContext } from "@/lib/server/api";
import { getInterviewView } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * GET /api/interview/sessions/:id (Intake Studio §11). Full session state:
 * turns, pending question, honest progress (stage + coverage, never a fake
 * percent), running session spend, cap, and pending proposed edits.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { sessionId } = await context.params;
  const view = await getInterviewView(auth.context.organization.id, sessionId);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ view });
}
