import { NextResponse } from "next/server";
import { representationStatus } from "@/lib/wepatent/domain/counsel-request";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { getAdapters } from "@/lib/server/adapters";
import { createCounselRequest } from "@/lib/server/services/counsel";

/**
 * GET /api/counsel-requests — every response carries the explicit
 * representation status so no client can infer representation from the mere
 * existence of a request (PRD §5.1–§5.3).
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const { data } = getAdapters();
  const requests = await data.listCounselRequests(auth.context.organization.id);
  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      state: request.state,
      representation: representationStatus(request.state),
      createdAt: request.createdAt,
    })),
  });
}

/** POST /api/counsel-requests — creates a draft request (limited intake). */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "counsel_request.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await readJsonBody(request);
  const result = await createCounselRequest({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    input: body,
  });
  if (!result.ok) return genericError(422);
  return NextResponse.json(
    {
      id: result.request.id,
      state: result.request.state,
      representation: representationStatus(result.request.state),
    },
    { status: 201 },
  );
}
