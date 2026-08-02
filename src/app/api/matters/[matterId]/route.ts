import { getMatterEndpoint, patchMatterEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

export const GET = withSession(async (session, _request, params) =>
  getMatterEndpoint(session, params.matterId),
);

export const PATCH = withSession(async (session, request, params) =>
  patchMatterEndpoint(session, params.matterId, await readJson(request)),
);
