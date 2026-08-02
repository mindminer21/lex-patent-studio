import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { enqueueJob } from "@/lib/server/jobs/runner";
import { estimateDistillation } from "@/lib/server/services/distillation";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(120),
});

/**
 * POST /api/inventions/:id/studio/distill (Intake Studio §11, FR-INT-4).
 * Enqueues the record-level distillation job. The response carries the
 * customer-facing estimate + wallet sufficiency so the UI can show cost
 * before/after (FR-INT-10); rates never leave the server.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);

  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const estimated = await estimateDistillation(auth.context.organization.id, id);
  const wallet = await data.getWallet(auth.context.organization.id);
  const availableCents = wallet ? wallet.balanceCents - wallet.reservedCents : 0;

  const result = await enqueueJob({
    organizationId: auth.context.organization.id,
    kind: "distillation",
    idempotencyKey: parsed.data.idempotencyKey,
    payload: { inventionId: id, userId: auth.context.user.id },
  });
  if (!result.ok) return genericError(400);

  return NextResponse.json(
    {
      jobId: result.job.id,
      status: result.job.status,
      deduplicated: result.deduplicated,
      estimate: estimated
        ? {
            customerLowCents: estimated.estimate.customerLowCents,
            customerHighCents: estimated.estimate.customerHighCents,
            rateVersion: estimated.estimate.rateVersion,
            walletAvailableCents: availableCents,
            sufficient: availableCents >= estimated.estimate.customerHighCents,
          }
        : null,
    },
    { status: result.deduplicated ? 200 : 202 },
  );
}
