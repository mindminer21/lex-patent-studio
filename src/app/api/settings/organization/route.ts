import { NextResponse } from "next/server";
import { z } from "zod";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { updateOrganizationName } from "@/lib/server/services/orgs";

const bodySchema = z.object({
  name: z.string().trim().min(2).max(120),
});

/**
 * PUT /api/settings/organization — autosave for the organization name
 * (design rule: minimal human input; no Save button). The first
 * organization is auto-created with a placeholder name on first sign-in,
 * so this is how the user makes it theirs. Owner-only (`org.manage`),
 * bounds-checked against the DB constraint (2–120), audited on every
 * change.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);
  const result = await updateOrganizationName({
    organizationId: auth.context.organization.id,
    actorUserId: auth.context.user.id,
    actorRole: auth.context.membership.role,
    name: parsed.data.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "forbidden" ? 403 : 400 },
    );
  }
  return NextResponse.json({ name: result.name });
}
