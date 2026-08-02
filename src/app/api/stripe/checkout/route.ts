import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { ALLOWED_TOP_UP_CENTS } from "@/lib/server/adapters/production/stripe-billing";
import { genericError, readJsonBody, requireApiOrgContext } from "@/lib/server/api";
import { BILLING_PLANS } from "@/lib/server/billing-plans";
import { startCheckoutSession } from "@/lib/server/services/billing";

const bodySchema = z.union([
  z.object({
    kind: z.literal("wallet_top_up"),
    amountCents: z
      .number()
      .int()
      .refine((cents) => (ALLOWED_TOP_UP_CENTS as readonly number[]).includes(cents)),
  }),
  z.object({
    kind: z.literal("subscription"),
    planId: z
      .string()
      .max(32)
      .refine((id) => BILLING_PLANS.some((plan) => plan.selfService && plan.id === id)),
  }),
]);

/**
 * POST /api/stripe/checkout (PRD §10, FR-6): creates a Checkout session for
 * a wallet top-up or subscription and returns the redirect URL. Requires the
 * billing.manage permission. Local mode hands off to the clearly labeled
 * simulated checkout; production uses the Stripe adapter (approval-gated).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiOrgContext();
  if (!auth.ok) return auth.response;
  if (!can(auth.context.membership.role, "billing.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return genericError(400);

  const result = await startCheckoutSession({
    organizationId: auth.context.organization.id,
    userId: auth.context.user.id,
    request:
      parsed.data.kind === "wallet_top_up"
        ? { kind: "wallet_top_up", amountCents: parsed.data.amountCents }
        : { kind: "subscription", planId: parsed.data.planId },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ url: result.url });
}
