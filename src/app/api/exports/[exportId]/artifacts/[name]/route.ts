import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";
import { verifyDownloadToken } from "@/lib/server/services/export-download";

type RouteContext = { params: Promise<{ exportId: string; name: string }> };

/**
 * GET /api/exports/:id/artifacts/:name?token=… — artifact download.
 * Requires BOTH an authenticated session in the owning organization AND a
 * short-lived signed token minted for this exact artifact (PRD §7.5).
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { exportId: id, name } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyDownloadToken(token);
  if (
    !claims ||
    claims.exportId !== id ||
    claims.name !== decodeURIComponent(name) ||
    claims.organizationId !== auth.context.organization.id
  ) {
    return NextResponse.json({ error: "link_expired" }, { status: 403 });
  }

  const { data, storage } = getAdapters();
  const artifacts = await data.listExportArtifacts(auth.context.organization.id, id);
  const artifact = artifacts.find((entry) => entry.name === claims.name);
  if (!artifact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const bytes = await storage.get(artifact.storagePath);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": artifact.contentType,
      "Content-Length": String(artifact.byteSize),
      "Content-Disposition": `attachment; filename="${artifact.name}"`,
      "X-Checksum-Sha256": artifact.sha256,
      "Cache-Control": "private, no-store",
    },
  });
}
