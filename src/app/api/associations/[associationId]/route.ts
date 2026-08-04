import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import {
  confirmAssociation,
  deleteAssociation,
  updateAssociationRegion,
} from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ associationId: string }> };

const patchSchema = z.union([
  z.object({
    action: z.literal("confirm"),
  }),
  z.object({
    action: z.literal("redraw"),
    region: z.object({
      page: z.number().int().min(1).nullable().optional(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      view: z.string().max(40).nullable().optional(),
    }),
  }),
]);

/**
 * PATCH /api/associations/:id (FR-INT-9): confirm an AI-proposed anchor
 * or redraw/adjust a region. Both are human actions through the domain
 * guard — there is no model-facing route to these transitions.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { associationId } = await context.params;
  const body = await readJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return genericError(400);

  const result =
    parsed.data.action === "confirm"
      ? await confirmAssociation({
          organizationId: auth.context.organization.id,
          userId: auth.context.user.id,
          associationId,
        })
      : await updateAssociationRegion({
          organizationId: auth.context.organization.id,
          userId: auth.context.user.id,
          associationId,
          region: parsed.data.region,
        });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ association: result.association });
}

/** DELETE /api/associations/:id — removing an AI proposal records a rejection. */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { associationId } = await context.params;
  const result = await deleteAssociation({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    associationId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
