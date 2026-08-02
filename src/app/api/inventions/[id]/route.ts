import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/inventions/:id — tenant scope enforced from the session. */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const facts = await data.listFacts(auth.context.organization.id, id);
  return NextResponse.json({
    invention,
    facts: facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      statement: fact.statement,
      provenance: fact.provenance,
    })),
  });
}

/** DELETE /api/inventions/:id — soft delete (PRD FR-3). */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await data.softDeleteInvention(auth.context.organization.id, id);
  await data.appendAuditEvent({
    organizationId: auth.context.organization.id,
    actor: auth.context.user.id,
    action: "invention.soft_deleted",
    target: id,
    meta: {},
  });
  return NextResponse.json({ ok: true });
}
