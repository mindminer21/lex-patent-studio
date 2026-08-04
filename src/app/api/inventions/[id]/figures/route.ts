import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { enqueueJob } from "@/lib/server/jobs/runner";
import { getLatestFigureSetView } from "@/lib/server/services/figures";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(120),
  draftVersionId: z.string().min(1).max(120).nullable().optional(),
});

/**
 * GET /api/inventions/:id/figures — the current figure set, its validation
 * report, and whether line-art generation is available at all.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const { data } = getAdapters();
  const invention = await data.getInvention(auth.context.organization.id, id);
  if (!invention) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const view = await getLatestFigureSetView(auth.context.organization.id, id);
  return NextResponse.json({
    figureSet: view.set,
    figures: view.figures,
    numerals: view.numerals,
    sheets: view.sheets.map((sheet) => ({
      sheetNumber: sheet.sheetNumber,
      totalSheets: sheet.totalSheets,
      checksumSha256: sheet.checksumSha256,
    })),
    validations: view.validations,
    lineArtAvailable: view.lineArtAvailable,
    // The product must never claim more than this (spec §8).
    validationDisclaimer:
      "Mechanical formality checks against published formal drawing requirements — not a legal opinion and not a guarantee of USPTO acceptance.",
  });
}

/**
 * POST /api/inventions/:id/figures — enqueue the durable figure pipeline
 * (spec §5). The request path never waits; poll GET /api/jobs/:id.
 * Idempotency key required: retries attach to the same job and can never
 * double-charge.
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
    kind: "figure_plan",
    idempotencyKey: parsed.data.idempotencyKey,
    payload: {
      inventionId: id,
      draftVersionId: parsed.data.draftVersionId ?? null,
      userId: auth.context.user.id,
    },
  });
  if (!result.ok) return genericError(400);
  return NextResponse.json(
    { jobId: result.job.id, status: result.job.status, deduplicated: result.deduplicated },
    { status: 202 },
  );
}
