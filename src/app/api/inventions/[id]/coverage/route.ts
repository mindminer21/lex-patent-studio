import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";
import { getLedger } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/inventions/:id/coverage (Intake Studio §11, FR-INT-8).
 * Deterministic coverage of the RECORD — never a legal sufficiency opinion
 * (the caveat ships in the payload so every consumer carries it).
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
    coverage: ledger.coverage,
    caveat:
      "Coverage of the record computed by deterministic checklist code (never model output). It is not a legal sufficiency opinion; qualified patent counsel must assess enablement and written description.",
  });
}
