import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { deletePair, editPair } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ pairId: string }> };

const patchSchema = z.object({
  statement: z.string().min(3).max(4000),
});

/** PATCH /api/ps-pairs/:id — user edit; state becomes user_edited. */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { pairId } = await context.params;
  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return genericError(400);
  const result = await editPair({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    pairId,
    statement: parsed.data.statement,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ pair: result.pair });
}

/**
 * DELETE /api/ps-pairs/:id — user deletion. Deleting an ai_proposed item
 * records an ai_proposal_rejected event (feature PRD §5.4).
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { pairId } = await context.params;
  const result = await deletePair({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    pairId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ deleted: true });
}
