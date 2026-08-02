import { NextResponse } from "next/server";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { signUpload } from "@/lib/server/services/uploads";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/inventions/:id/uploads/sign (FR-4): validates the upload
 * request against the allowlist (type, extension, size) and returns a
 * short-lived, single-source upload token. Rejections happen here, before
 * any byte is transferred.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body === null) return genericError(400);

  const result = await signUpload({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    inventionId: id,
    input: body,
  });
  if (!result.ok) {
    const status = result.error === "invention_not_found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({
    sourceId: result.sourceId,
    uploadUrl: `/api/uploads/${encodeURIComponent(result.token)}`,
    expiresAt: result.expiresAt,
  });
}
