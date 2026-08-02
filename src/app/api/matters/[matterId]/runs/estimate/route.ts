import { estimateRunEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

export const POST = withSession(async (session, request, params) =>
  estimateRunEndpoint(session, params.matterId, await readJson(request)),
);
