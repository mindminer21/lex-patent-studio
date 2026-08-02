import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { getModelTier, isWorkflowAllowed } from "@/lib/server/model-registry";
import { estimateForTier } from "@/lib/server/services/generation";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  workflow: z.enum(["invention_disclosure_summary", "counsel_question_list", "gap_analysis"]),
  tierId: z.string().min(1).max(60),
});

/**
 * POST /api/inventions/:id/generations/estimate (PRD §10, §7.4 step 2):
 * customer-facing cost range plus wallet sufficiency. Provider rates never
 * leave the server — only computed customer amounts are returned (FR-6).
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);
  if (!isWorkflowAllowed(parsed.data.workflow, parsed.data.tierId)) {
    return NextResponse.json({ error: "workflow_not_allowed" }, { status: 400 });
  }
  const tier = getModelTier(parsed.data.tierId);
  if (!tier) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const facts = await data.listFacts(auth.context.organization.id, id);
  const wallet = await data.getWallet(auth.context.organization.id);

  const approximateInputTokens = Math.max(
    200,
    Math.ceil(
      (invention.summary.length +
        invention.problem.length +
        invention.solution.length +
        facts.reduce((sum, fact) => sum + fact.statement.length, 0)) /
        4,
    ),
  );
  const estimate = estimateForTier(tier, approximateInputTokens);
  const availableCents = wallet ? wallet.balanceCents - wallet.reservedCents : 0;
  return NextResponse.json({
    customerLowCents: estimate.customerLowCents,
    customerHighCents: estimate.customerHighCents,
    rateVersion: estimate.rateVersion,
    walletAvailableCents: availableCents,
    sufficient: availableCents >= estimate.customerHighCents,
  });
}
