import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/domain/uploads";
import { acceptUpload } from "@/lib/server/services/uploads";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * PUT /api/uploads/:token (FR-4): receives the bytes for a previously
 * signed upload. The token is HMAC-signed, expiring, and scoped to exactly
 * one source in one organization. Bytes are re-validated (size cap, magic
 * signature), stored in private storage, quarantined, and scanned
 * asynchronously — never directly usable.
 */
export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const result = await acceptUpload({
    token: decodeURIComponent(token),
    bytes: new Uint8Array(buffer),
  });
  if (!result.ok) {
    const status =
      result.error === "invalid_token" || result.error === "source_not_found"
        ? 404
        : result.error === "already_uploaded"
          ? 409
          : 422;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({
    sourceId: result.source.id,
    status: result.source.status,
    checksumSha256: result.source.checksumSha256,
  });
}
