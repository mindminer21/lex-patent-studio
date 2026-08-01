import type {
  BillingPort,
  DataPort,
  ModelGatewayPort,
  ModelGenerationResult,
} from "../types";

/**
 * Production adapter seams — intentionally stubbed (PRD §17: creating or
 * changing paid Supabase/Stripe/model-provider accounts is approval-gated).
 *
 * TODO(production, requires Jeff's approval per PRD §17):
 * - SupabaseDataAdapter: implement DataPort against the private application
 *   project using @supabase/ssr server clients, RLS-scoped queries, and the
 *   migrations in supabase/migrations/.
 * - StripeBillingAdapter: Checkout + Customer Portal + verified webhooks
 *   through a billing outbox (FR-6).
 * - ProviderModelGateway: OpenAI/Anthropic/xAI adapters with effective-dated
 *   price registry, allowlists, token/cost caps, timeouts, retries, kill
 *   switch, and circuit breaker (FR-5).
 */
const NOT_CONFIGURED =
  "Production adapters are not configured. Run with APP_MODE=local, or complete the approval-gated production setup (PRD §17).";

export class SupabaseDataAdapter implements Partial<DataPort> {
  constructor() {
    throw new Error(NOT_CONFIGURED);
  }
}

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
