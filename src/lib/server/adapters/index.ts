import "server-only";

import { env } from "@/lib/env";
import type { Adapters, BillingPort } from "./types";
import { LocalDataAdapter } from "./local/store";
import { LocalModelGateway } from "./local/model-gateway";

/**
 * Adapter selection by environment contract. Local mode is fully
 * credential-independent; production mode requires the approval-gated
 * external accounts and is intentionally not wired yet (PRD §17).
 */
class LocalBillingAdapter implements BillingPort {
  async createCheckoutSession(): Promise<{ url: string }> {
    // Local mode has no live billing (PRD §17.4). The UI explains this.
    throw new Error("billing_not_available_in_local_mode");
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new Error("billing_not_available_in_local_mode");
  }
}

let cached: Adapters | null = null;

export function getAdapters(): Adapters {
  if (cached) return cached;
  if (env.APP_MODE === "production") {
    // TODO(production, approval-gated per PRD §17): instantiate
    // SupabaseDataAdapter, StripeBillingAdapter, and ProviderModelGateway
    // from ./production once accounts and credentials are approved.
    throw new Error(
      "APP_MODE=production is not yet enabled: production adapters are approval-gated (PRD §17).",
    );
  }
  cached = {
    data: new LocalDataAdapter(),
    modelGateway: new LocalModelGateway(),
    billing: new LocalBillingAdapter(),
  };
  return cached;
}
