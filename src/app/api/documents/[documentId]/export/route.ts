import { exportDocumentEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";
import { withIdempotency } from "@/lib/api/idempotency";

/** Money/job endpoint: Idempotency-Key required (PRD §12 conventions). */
export const POST = withSession(async (session, request, params) => {
  const body = await readJson(request);
  return withIdempotency(
    request,
    `POST /api/documents/${params.documentId}/export`,
    body,
    () => exportDocumentEndpoint(session, params.documentId),
  );
});
