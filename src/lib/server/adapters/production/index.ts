export { SupabaseDataAdapter } from "./supabase-data";
export { ProviderModelGateway } from "./model-gateway";
export { StripeBillingAdapter } from "./stripe-billing";
export { SupabaseStorageAdapter } from "./supabase-storage";

/**
 * Production adapters. All are fully implemented and unit-tested against
 * injected transports; *activation* is approval-gated (PRD §17): they run
 * only when Jeff provisions the external accounts and sets the credentials.
 *
 * - SupabaseDataAdapter: implemented; schema validated by the pgTAP harness
 *   in supabase/tests/ (./scripts/test-rls.sh).
 * - ProviderModelGateway (./model-gateway): OpenAI/Anthropic/xAI with
 *   effective-dated price registry, caps, timeout, bounded retry, kill
 *   switch, and per-provider circuit breaker (FR-5).
 * - StripeBillingAdapter (./stripe-billing): Checkout + Customer Portal;
 *   verified webhooks are handled by /api/webhooks/stripe (FR-6).
 * - SupabaseStorageAdapter (./supabase-storage): private-bucket Storage
 *   behind StoragePort.
 */
