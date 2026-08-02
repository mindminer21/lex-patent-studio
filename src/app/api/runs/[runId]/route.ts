import { getRunEndpoint } from "@/lib/api/endpoints";
import { withSession } from "@/lib/api/http";

/** Stage status, per-stage checkpoints, reservation, and cost. */
export const GET = withSession(async (session, _request, params) =>
  getRunEndpoint(session, params.runId),
);
