import "server-only";

import { env } from "@/lib/env";
import type { Adapters, BillingPort, CheckoutRequest } from "./types";
import { LocalDataAdapter } from "./local/store";
import { LocalModelGateway } from "./local/model-gateway";
import { LocalStorageAdapter } from "./local/storage";
import {
  ProviderModelGateway,
  StripeBillingAdapter,
  SupabaseDataAdapter,
  SupabaseStorageAdapter,
} from "./production";

/**
 * Adapter selection by environment contract. Local mode is fully
 * credential-independent. Production mode wires the SupabaseDataAdapter
 * against the private application project; billing, model gateway, and
 * storage remain approval-gated stubs that throw on use (PRD §17).
 */
/**
 * Local billing adapter: no Stripe account exists (PRD §17.4), so checkout
 * and portal hand off to clearly labeled simulated pages. The simulated
 * checkout completes by signing a synthetic `checkout.session.completed`
 * event with the local webhook secret and running it through the SAME
 * verification/dedupe/outbox pipeline production uses (FR-6 seam).
 */
class LocalBillingAdapter implements BillingPort {
  async createCheckoutSession(
    _organizationId: string,
    request: CheckoutRequest,
  ): Promise<{ url: string }> {
    const params =
      request.kind === "wallet_top_up"
        ? `kind=wallet_top_up&amount=${request.amountCents}`
        : `kind=subscription&plan=${encodeURIComponent(request.planId)}`;
    return { url: `/app/billing/simulated-checkout?${params}` };
  }

  async createPortalSession(): Promise<{ url: string }> {
    return { url: "/app/billing/simulated-portal" };
  }
}

let cached: Adapters | null = null;

export function getAdapters(): Adapters {
  if (cached) return cached;
  if (env.APP_MODE === "production") {
    // loadEnv() has already fail-fasted unless every production variable is
    // present (src/lib/env). Data-plane traffic goes to Supabase; the model
    // gateway refuses runs for providers whose keys are absent (PRD §17).
    cached = {
      data: new SupabaseDataAdapter({
        url: env.SUPABASE_URL!,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      }),
      modelGateway: new ProviderModelGateway({
        keys: {
          openai: env.OPENAI_API_KEY,
          anthropic: env.ANTHROPIC_API_KEY,
          xai: env.XAI_API_KEY,
        },
        killSwitch: env.MODEL_GATEWAY_KILL_SWITCH === "1",
      }),
      billing: new StripeBillingAdapter({
        secretKey: env.STRIPE_SECRET_KEY!,
        appUrl: env.NEXT_PUBLIC_APP_URL,
        getCustomerId: (organizationId) => getAdapters().data.getStripeCustomerId(organizationId),
      }),
      storage: new SupabaseStorageAdapter({
        url: env.SUPABASE_URL!,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      }),
    };
    return cached;
  }
  cached = {
    data: new LocalDataAdapter(),
    modelGateway: new LocalModelGateway(),
    billing: new LocalBillingAdapter(),
    storage: new LocalStorageAdapter(),
  };
  return cached;
}
