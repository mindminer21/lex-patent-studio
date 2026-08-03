import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { submitInterviewTurn } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

const bodySchema = z
  .object({ kind: z.enum(["skip", "unknown"]).default("skip") })
  .default({ kind: "skip" });

/**
 * POST /api/interview/sessions/:id/skip (Intake Studio §11). Records a
 * skip or "I don't know" for the pending question — an enablement signal,
 * not a failure (§6.1). No model call, no charge.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await readJsonBody(request);
  const body = bodySchema.safeParse(raw ?? {});
  if (!body.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { sessionId } = await context.params;
  const result = await submitInterviewTurn({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    sessionId,
    kind: body.data.kind,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "session_not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ view: result.view, warnings: result.warnings });
}
