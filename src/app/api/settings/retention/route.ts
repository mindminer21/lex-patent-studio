import { NextResponse } from "next/server";
import { z } from "zod";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { updateRetentionPolicy } from "@/lib/server/services/retention";

const bodySchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
});

/**
 * PUT /api/settings/retention — autosave for the owner's retention window
 * (design rule: minimal human input; no Update button). Same service as
 * the old form action: owner-only (`org.manage`), bounds-checked against
 * the DB constraint, and audited on every change.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);
  const result = await updateRetentionPolicy({
    organizationId: auth.context.organization.id,
    actorUserId: auth.context.user.id,
    actorRole: auth.context.membership.role,
    retentionDays: parsed.data.retentionDays,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "forbidden" ? 403 : 400 },
    );
  }
  return NextResponse.json({ retentionDays: result.retentionDays });
}
