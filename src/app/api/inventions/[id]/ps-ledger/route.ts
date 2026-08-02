import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";
import { getLedger } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/inventions/:id/ps-ledger (Intake Studio §11, FR-INT-5).
 * Full ledger read model: pairs, links, components, associations, current
 * working title, and the deterministic coverage meter.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ledger = await getLedger(auth.context.organization.id, id);
  return NextResponse.json({
    ...ledger,
    notice:
      "Working draft — counsel review required. AI items are proposals (ai_proposed) until you confirm, edit, or delete them. The coverage meter measures record coverage, not legal sufficiency.",
  });
}
