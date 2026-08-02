import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { enqueueJob } from "@/lib/server/jobs/runner";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  workflow: z.enum(["invention_disclosure_summary", "counsel_question_list", "gap_analysis"]),
  tierId: z.string().min(1).max(60),
  idempotencyKey: z.string().min(8).max(120),
});

/**
 * POST /api/inventions/:id/generations — enqueue a durable generation job
 * (PRD §7.4, §14). The request path never waits for the model; poll
 * GET /api/jobs/:id. Idempotency key required (PRD §10) — retries attach to
 * the same job and can never double-charge.
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

  const result = await enqueueJob({
    organizationId: auth.context.organization.id,
    kind: "generation",
    idempotencyKey: parsed.data.idempotencyKey,
    payload: {
      inventionId: id,
      workflow: parsed.data.workflow,
      tierId: parsed.data.tierId,
      userId: auth.context.user.id,
    },
  });
  if (!result.ok) return genericError(400);

  return NextResponse.json(
    { jobId: result.job.id, status: result.job.status, deduplicated: result.deduplicated },
    { status: result.deduplicated ? 200 : 202 },
  );
}
