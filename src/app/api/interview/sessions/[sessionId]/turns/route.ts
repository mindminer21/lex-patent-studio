import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { submitInterviewTurn } from "@/lib/server/services/interview";

type RouteContext = { params: Promise<{ sessionId: string }> };

const bodySchema = z.object({
  kind: z.enum(["answer", "skip", "unknown"]).default("answer"),
  answerText: z.string().max(8_000).optional(),
  attachmentSourceIds: z.array(z.string().min(1).max(100)).max(5).default([]),
});

/**
 * POST /api/interview/sessions/:id/turns (Intake Studio §11, FR-INT-6/7).
 * Submits the pending turn (answer / skip / "I don't know", optional
 * attachments) and returns the updated session view with the next
 * question. Advice-seeking answers receive the FIXED counsel-referral
 * template (deterministic classifier — never model-generated advice).
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
  const result = await submitInterviewTurn({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    sessionId,
    kind: body.data.kind,
    answerText: body.data.answerText,
    attachmentSourceIds: body.data.attachmentSourceIds,
  });
  if (!result.ok) {
    const status =
      result.error === "session_not_found"
        ? 404
        : result.error === "cap_reached"
          ? 402
          : result.error === "invalid_input"
            ? 400
            : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({
    view: result.view,
    warnings: result.warnings,
    counselReferral: result.counselReferral,
  });
}
