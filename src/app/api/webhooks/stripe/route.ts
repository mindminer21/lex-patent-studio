import { NextResponse } from "next/server";
import { MAX_WEBHOOK_BODY_BYTES, processStripeWebhook } from "@/lib/server/services/billing";

/**
 * POST /api/webhooks/stripe (PRD §10, FR-6).
 *
 * Unauthenticated by design — Stripe calls it. Authenticity comes from the
 * verified `Stripe-Signature` HMAC; replays are bounded by the timestamp
 * tolerance and event-id idempotency. Responses are generic: no internal
 * detail leaves this endpoint.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const payload = await request.text();
  if (payload.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  const result = await processStripeWebhook({
    payload,
    signatureHeader: request.headers.get("stripe-signature"),
  });

  if (!result.ok) {
    const status = result.error === "not_configured" ? 503 : 400;
    return NextResponse.json({ error: "webhook_rejected" }, { status });
  }
  return NextResponse.json({ received: true, status: result.status });
}
