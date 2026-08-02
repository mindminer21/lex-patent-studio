import { approveFactEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

export const POST = withSession(async (session, request, params) =>
  approveFactEndpoint(
    session,
    params.matterId,
    params.factId,
    await readJson(request),
  ),
);
