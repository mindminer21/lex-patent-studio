import { decideReviewEndpoint } from "@/lib/api/endpoints";
import { readJson, withSession } from "@/lib/api/http";

/**
 * Review decisions are recorded only for authenticated humans with the
 * required role at the item's tier — the domain gate (Invariant 16) is the
 * single authority; model/system actors have no path here.
 */
export const POST = withSession(async (session, request, params) =>
  decideReviewEndpoint(session, params.reviewItemId, await readJson(request)),
);
