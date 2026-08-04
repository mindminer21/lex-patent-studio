import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { autosaveWorkingTitle } from "@/lib/server/services/ps-ledger";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  text: z.string().min(3).max(400),
});

/**
 * PUT /api/inventions/:id/working-title — inline autosave for the working
 * title (design rule: minimize human steps and inputs; no Save button).
 * Provenance is decided server-side: text equal to the current
 * `ai_proposed` proposal is an acceptance (`user_confirmed` +
 * `title_confirmed`); a change is a user edit (`user_edited` +
 * `title_edited`); re-sending the current reviewed title is an idempotent
 * no-op so debounce + blur can never duplicate history rows.
 */
export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "invention.edit")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await readJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return genericError(400);
  const result = await autosaveWorkingTitle({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    inventionId: id,
    text: parsed.data.text,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ title: result.title, outcome: result.outcome });
}
