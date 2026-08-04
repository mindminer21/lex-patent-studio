import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { addRegionAssociation } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ pairId: string }> };

const bodySchema = z.object({
  sourceId: z.string().min(1).max(80),
  region: z.object({
    page: z.number().int().min(1).nullable().optional(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    view: z.string().max(40).nullable().optional(),
  }),
});

/**
 * POST /api/ps-pairs/:id/associations (feature PRD §11, FR-INT-9): the
 * user draws a region anchor on a source and links it to this solution.
 * Human action → `user_confirmed` via the domain guard; AI-proposed
 * anchors arrive only through distillation and only as `ai_proposed`.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { pairId } = await context.params;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);

  const result = await addRegionAssociation({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    solutionId: pairId,
    sourceId: parsed.data.sourceId,
    region: parsed.data.region,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ association: result.association }, { status: 201 });
}
