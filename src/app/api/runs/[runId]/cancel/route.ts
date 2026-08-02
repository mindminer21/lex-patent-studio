import { cancelRunEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

export const POST = withSession(async (session, _request, params) =>
  cancelRunEndpoint(session, params.runId),
);
