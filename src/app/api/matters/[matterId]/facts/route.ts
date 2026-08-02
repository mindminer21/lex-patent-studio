import { createFactEndpoint, listFactsEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

export const GET = withSession(async (session, _request, params) =>
  listFactsEndpoint(session, params.matterId),
);

export const POST = withSession(async (session, request, params) =>
  createFactEndpoint(session, params.matterId, await readJson(request)),
);
