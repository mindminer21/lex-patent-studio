import { listDocumentsEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

export const GET = withSession(async (session, _request, params) =>
  listDocumentsEndpoint(session, params.matterId),
);
