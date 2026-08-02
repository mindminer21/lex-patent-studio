import type {
  BillingPort,
  ModelGatewayPort,
  ModelGenerationResult,
  StoragePort,
} from "../types";

export { SupabaseDataAdapter } from "./supabase-data";

/**
 * Remaining production adapter seams — intentionally stubbed (PRD §17:
 * creating or changing paid Stripe/model-provider accounts is
 * approval-gated). The SupabaseDataAdapter is implemented (validated against
 * the migrations via the pgTAP harness in supabase/tests/); these throw
 * with a clear message until Jeff approves the external accounts.
 *
 * TODO(production, requires Jeff's approval per PRD §17):
 * - StripeBillingAdapter: Checkout + Customer Portal + verified webhooks
 *   through a billing outbox (FR-6).
 * - ProviderModelGateway: OpenAI/Anthropic/xAI adapters with effective-dated
 *   price registry, allowlists, token/cost caps, timeouts, retries, kill
 *   switch, and circuit breaker (FR-5).
 * - SupabaseStorageAdapter: private bucket + signed URLs behind StoragePort.
 */
const NOT_CONFIGURED =
  "This production adapter is approval-gated and not configured (PRD §17). Run with APP_MODE=local.";

export class StripeBillingAdapter implements BillingPort {
  async createCheckoutSession(): Promise<{ url: string }> {
    throw new Error(NOT_CONFIGURED);
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new Error(NOT_CONFIGURED);
  }
}

export class ProviderModelGateway implements ModelGatewayPort {
  async generate(): Promise<ModelGenerationResult> {
    throw new Error(NOT_CONFIGURED);
  }
}

export class SupabaseStorageAdapter implements StoragePort {
  async put(): Promise<void> {
    throw new Error(NOT_CONFIGURED);
  }

  async get(): Promise<Uint8Array | null> {
    throw new Error(NOT_CONFIGURED);
  }

  async delete(): Promise<void> {
    throw new Error(NOT_CONFIGURED);
  }
}
