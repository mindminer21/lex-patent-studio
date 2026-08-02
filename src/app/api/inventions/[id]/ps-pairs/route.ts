import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { addManualPair } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  kind: z.enum(["problem", "solution"]),
  statement: z.string().min(3).max(4000),
});

/** POST /api/inventions/:id/ps-pairs — manual user-authored ledger item. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);
  const result = await addManualPair({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    inventionId: id,
    kind: parsed.data.kind,
    statement: parsed.data.statement,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ pair: result.pair }, { status: 201 });
}
