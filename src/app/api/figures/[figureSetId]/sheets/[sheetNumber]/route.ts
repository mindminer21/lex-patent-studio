import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/server/adapters";
import { requireApiOrgContext } from "@/lib/server/api";

type RouteContext = { params: Promise<{ figureSetId: string; sheetNumber: string }> };

/**
 * GET /api/figures/:figureSetId/sheets/:n — one composed drawing sheet.
 *
 * Session-scoped to the owning organization; the adapter query is filtered
 * by the session's organization id, so a guessed figure-set id from another
 * tenant resolves to nothing.
 */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { figureSetId, sheetNumber } = await context.params;

  const { data, storage } = getAdapters();
  const sheets = await data.listFigureSheets(auth.context.organization.id, figureSetId);
  const sheet = sheets.find((entry) => entry.sheetNumber === Number(sheetNumber));
  if (!sheet) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bytes = await storage.get(sheet.storagePath);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": sheet.contentType,
      "Content-Length": String(bytes.byteLength),
      "X-Checksum-Sha256": sheet.checksumSha256,
      // Working draft, never filing-ready (invariant 4).
      "X-Wepatent-Label": "working-draft-counsel-review-required",
      "Cache-Control": "private, no-store",
    },
  });
}
