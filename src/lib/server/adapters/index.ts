import "server-only";

import { env } from "@/lib/env";
import type { Adapters, BillingPort } from "./types";
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
    // loadEnv() has already fail-fasted unless every production variable is
    // present (src/lib/env). Data-plane traffic goes to Supabase; billing
    // and provider generation throw until approved (PRD §17).
    cached = {
      data: new SupabaseDataAdapter({
        url: env.SUPABASE_URL!,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      }),
      modelGateway: new ProviderModelGateway(),
      billing: new StripeBillingAdapter(),
      storage: new SupabaseStorageAdapter(),
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
