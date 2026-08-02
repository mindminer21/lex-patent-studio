import { NextResponse } from "next/server";
import { z } from "zod";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { acceptCurrentTerms } from "@/lib/server/services/terms";

const bodySchema = z.object({
  termsVersion: z.string().min(1).max(64),
  acknowledgedKeys: z.array(z.string().max(64)).max(16),
});

/** POST /api/terms/accept (PRD §10) — server-side clickwrap record. */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);

  const result = await acceptCurrentTerms({
    userId: auth.context.user.id,
    organizationId: auth.context.organization.id,
    termsVersion: parsed.data.termsVersion,
    acknowledgedKeys: parsed.data.acknowledgedKeys,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json({
    acceptanceId: result.acceptance.id,
    termsVersion: result.acceptance.termsVersion,
    acceptedAt: result.acceptance.acceptedAt,
  });
}
