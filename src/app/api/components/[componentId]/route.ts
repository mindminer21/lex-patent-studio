import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { deleteComponent, editComponent } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ componentId: string }> };

const patchSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(2_000).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    "nothing to change",
  );

/**
 * PATCH /api/components/:id — user edit of a component's name/descriptor
 * (the interview's components panel autosaves through here; there is no
 * Save button). The state becomes `user_edited` via the ps-ledger guard.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { componentId } = await context.params;
  const parsed = patchSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);
  const result = await editComponent({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    componentId,
    name: parsed.data.name,
    description: parsed.data.description,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ component: result.component });
}

/**
 * DELETE /api/components/:id — user deletion. Deleting an `ai_proposed`
 * component records an `ai_proposal_rejected` event (feature PRD §5.4).
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { componentId } = await context.params;
  const result = await deleteComponent({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    componentId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ deleted: true });
}
