import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { createExport } from "@/lib/server/services/exports";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  draftVersionId: z.string().min(1).max(120).nullable().optional(),
  sections: z.array(z.string().min(1).max(80)).min(1).max(16),
});

/**
 * POST /api/inventions/:id/exports (PRD §10, §7.5): creates a version-locked
 * counsel-package manifest and enqueues DOCX/PDF artifact rendering off the
 * request path. The export references immutable version ids; later record
 * changes never alter it.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "export.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);

  const result = await createExport({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    inventionId: id,
    draftVersionId: parsed.data.draftVersionId ?? null,
    sections: parsed.data.sections,
  });
  if (!result.ok) {
    const status = result.error === "invention_not_found" ? 404 : 422;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(
    {
      exportId: result.record.id,
      checksum: result.record.checksum,
      manifest: result.record.manifest,
    },
    { status: 201 },
  );
}
