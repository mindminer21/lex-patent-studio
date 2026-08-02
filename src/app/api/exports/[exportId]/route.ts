import { NextResponse } from "next/server";
import { getAdapters } from "@/lib/adapters";
import { can } from "@/lib/domain/roles";

/**
 * Download an immutable export artifact (DOCX). Binary response; all other
 * API conventions (session auth, role check, generic errors) still apply.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ exportId: string }> },
): Promise<NextResponse> {
  try {
    const adapters = getAdapters();
    const session = await adapters.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    if (!can(session.role, "matter.view")) {
      return NextResponse.json(
        { error: "Your role does not permit this action." },
        { status: 403 },
      );
    }
    const { exportId } = await ctx.params;
    const record = await adapters.data.getExport(session.organizationId, exportId);
    if (!record) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const bytes = Buffer.from(record.docxBase64, "base64");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${record.fileName}"`,
        "Content-Length": String(bytes.length),
        "X-Export-Sha256": record.docxSha256,
      },
    });
  } catch (err) {
    console.error("[api] unexpected error:", err);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
