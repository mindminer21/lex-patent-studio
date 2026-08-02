import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { enqueueJob } from "@/lib/server/jobs/runner";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Optional subset; default is every eligible (post-quarantine) source. */
  sourceIds: z.array(z.string().min(1).max(80)).max(50).optional(),
});

/**
 * POST /api/inventions/:id/studio/interpret (Intake Studio §11, FR-INT-3).
 * Enqueues one durable interpretation job per eligible source. Idempotent:
 * the per-source key attaches retries to the same job, and the reservation
 * layer guarantees a retry can never double-charge.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "draft.generate")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = (await readJsonBody(request)) ?? {};
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);

  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sources = await data.listSources(auth.context.organization.id, id);
  const eligible = sources.filter(
    (source) =>
      (source.status === "scanned" || source.status === "extracted") &&
      source.interpretationStatus !== "interpreted" &&
      (!parsed.data.sourceIds || parsed.data.sourceIds.includes(source.id)),
  );

  const jobs: Array<{ jobId: string; sourceId: string; deduplicated: boolean }> = [];
  for (const source of eligible) {
    const result = await enqueueJob({
      organizationId: auth.context.organization.id,
      kind: "source_interpretation",
      idempotencyKey: `interpret:${source.id}`,
      payload: { sourceId: source.id, userId: auth.context.user.id, inventionId: id },
    });
    if (result.ok) {
      jobs.push({ jobId: result.job.id, sourceId: source.id, deduplicated: result.deduplicated });
    }
  }
  return NextResponse.json({ jobs }, { status: jobs.length > 0 ? 202 : 200 });
}
