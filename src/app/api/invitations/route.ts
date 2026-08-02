import { NextResponse } from "next/server";
import { z } from "zod";
import { ORDINARY_USER_ROLES } from "@/lib/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { createInvitation } from "@/lib/server/services/invitations";

const bodySchema = z.object({
  email: z.email().max(254),
  role: z.string().refine((role) => (ORDINARY_USER_ROLES as readonly string[]).includes(role)),
});

/**
 * POST /api/invitations (PRD §10, §7.1): idempotent, expiring invitation.
 * Counsel roles can never be invited (FR-2) — the schema only admits
 * ordinary organization roles and the service re-validates. Invitation
 * EMAILS are not sent (approval-gated, PRD §17.6): the caller receives the
 * accept URL to share out-of-band.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);

  const result = await createInvitation({
    organizationId: auth.context.organization.id,
    inviterUserId: auth.context.user.id,
    inviterRole: auth.context.membership.role,
    input: parsed.data,
  });
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403 : 422;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(
    {
      invitationId: result.invitation.id,
      existing: result.existing,
      // Token only on first issue; it is stored hashed and cannot be re-read.
      acceptPath: result.token ? `/app/invitations/accept?token=${result.token}` : null,
      expiresAt: result.invitation.expiresAt,
    },
    { status: result.existing ? 200 : 201 },
  );
}
