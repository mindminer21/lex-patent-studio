import { NextResponse } from "next/server";
import { z } from "zod";
import { genericError, readJsonBody } from "@/lib/server/api";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { getSessionContext } from "@/lib/server/session";

const bodySchema = z.object({ name: z.string().trim().min(2).max(120) });

/**
 * POST /api/organizations (PRD §10, §7.1): creates the organization plus
 * owner membership, default retention, and wallet in one logical
 * transaction. A user who already belongs to an organization cannot create
 * a second one through this endpoint (single-org model for now).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const context = await getSessionContext();
  if (!context) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (context.membership) {
    return NextResponse.json({ error: "already_in_organization" }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);

  const organization = await createOrganizationForUser(context.user.id, parsed.data.name);
  return NextResponse.json(
    { organizationId: organization.id, name: organization.name },
    { status: 201 },
  );
}
