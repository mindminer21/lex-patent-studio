import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";
import { cancelJob } from "@/lib/server/jobs/runner";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/jobs/:id — durable-job status (PRD §10, §14). Tenant scope is
 * derived from the session; another organization's job id returns 404.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const { data } = getAdapters();
  const job = await data.getJob(auth.context.organization.id, id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    result: job.result,
    errorSummary: job.errorSummary,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
}

/** DELETE /api/jobs/:id — cancel a queued job. */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const { data } = getAdapters();
  const job = await data.getJob(auth.context.organization.id, id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const updated = await cancelJob(auth.context.organization.id, id);
  return NextResponse.json({ id, status: updated?.status ?? job.status });
}
