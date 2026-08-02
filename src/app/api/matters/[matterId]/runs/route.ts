import { createRunEndpoint, listRunsEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";
import { withIdempotency } from "@/lib/api/idempotency";

export const GET = withSession(async (session, _request, params) =>
  listRunsEndpoint(session, params.matterId),
);

/** Money/job endpoint: Idempotency-Key required (PRD §12 conventions). */
export const POST = withSession(async (session, request, params) => {
  const body = await readJson(request);
  return withIdempotency(
    request,
    `POST /api/matters/${params.matterId}/runs`,
    body,
    () => createRunEndpoint(session, params.matterId, body),
  );
});
