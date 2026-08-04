import { NextResponse } from "next/server";
import { genericError, requireApiOrgContext } from "@/lib/server/api";
import { saveIntakeStageDraft } from "@/lib/server/services/intake-draft";

/** Guard for the form-encoded body (PRD §10 request-size limits). */
const MAX_DRAFT_BODY_BYTES = 256 * 1024;

/**
 * POST /api/intake/draft — autosave for the classic guided form intake
 * (design rule: minimal human input; the "Save draft" button is gone).
 *
 * Accepts the stage form exactly as rendered, saves it as DRAFT state only,
 * and never validates: partial/invalid drafts persist safely and the stage
 * stays incomplete until "Save and continue" passes server-side validation.
 * Submission-time validation and the review-stage attestation are unchanged.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DRAFT_BODY_BYTES) {
    return genericError(413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return genericError(400);
  }

  const result = await saveIntakeStageDraft({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    stage: String(formData.get("stage") ?? ""),
    formData,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ savedAt: result.savedAt });
}
