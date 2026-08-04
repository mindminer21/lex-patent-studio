import { NextResponse } from "next/server";
import { requireApiOrgContext } from "@/lib/server/api";
import { getAdapters } from "@/lib/server/adapters";

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

/**
 * GET /api/inventions/:id/sources/:sourceId/raw (M3 source viewer):
 * serves the stored bytes of a source that CLEARED quarantine, to the
 * authenticated tenant only. Quarantined/rejected bytes are never served.
 *
 * Only well-known media types render inline (the viewer's <img>/<audio>);
 * everything else downloads as an opaque attachment so a crafted file
 * (e.g. SVG with script) can never execute in the app origin.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "video/mp4",
  "video/quicktime",
]);

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { id, sourceId } = await context.params;
  const { data, storage } = getAdapters();
  const source = await data.getSource(auth.context.organization.id, sourceId);
  if (!source || source.inventionId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (source.status !== "scanned" && source.status !== "extracted") {
    // FR-4: bytes that have not cleared the scan are never served.
    return NextResponse.json({ error: "not_available" }, { status: 409 });
  }
  const bytes = source.storagePath ? await storage.get(source.storagePath) : null;
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const declared = (source.mimeType ?? "").toLowerCase();
  const inline = INLINE_TYPES.has(declared);
  const filename = (source.originalFilename ?? source.name).replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": inline ? declared : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
    },
  });
}
