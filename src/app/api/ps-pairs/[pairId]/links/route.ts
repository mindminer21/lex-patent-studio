import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { linkPairs } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ pairId: string }> };

const bodySchema = z.object({
  counterpartId: z.string().min(1).max(80),
});

/**
 * POST /api/ps-pairs/:id/links — pair a problem with a solution
 * (many-to-many, Intake Studio §5.3/§11). :id may be either side; the
 * counterpart must be the opposite kind in the same invention.
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

  const { data } = getAdapters();
  const pair = await data.getPsPair(auth.context.organization.id, pairId);
  if (!pair) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const problemId = pair.kind === "problem" ? pair.id : parsed.data.counterpartId;
  const solutionId = pair.kind === "solution" ? pair.id : parsed.data.counterpartId;
  const result = await linkPairs({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    problemId,
    solutionId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ link: result.link }, { status: 201 });
}
