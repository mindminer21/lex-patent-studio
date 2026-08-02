import type { Adapters } from "@/lib/adapters/types";
import { getEnv } from "@/lib/env";
import { SupabaseAuthAdapter, supabaseTokenVerifier } from "./auth";
import { PgBillingAdapter } from "./billing";
import { PgDataAdapter } from "./data";
import { getPool } from "./db";
import { ProviderGatewayAdapter } from "./gateway";

/**
 * PRODUCTION adapter wiring (LEX_APP_MODE=production).
 *
 * Refuses to construct without the complete environment contract — that is
 * the env schema's superRefine, which getEnv() enforces before anything
 * here runs. The exact enabling actions (all Jeff, per PRD §20 /
 * PRD-wepatent §17):
 *
 *  1. Create the private Supabase project; apply supabase/migrations/;
 *     set LEX_SUPABASE_URL / LEX_SUPABASE_ANON_KEY /
 *     LEX_SUPABASE_SERVICE_ROLE_KEY / LEX_DATABASE_URL.
 *  2. Create the corpus project; apply supabase/corpus-migrations/;
 *     set LEX_CORPUS_* (separate credentials; §6.3).
 *  3. Create the Stripe account; set LEX_STRIPE_*; approve pricing
 *     (§20.14) and live billing (§17.4) before enabling top-ups.
 *  4. Provision provider keys with no-training terms; set
 *     LEX_PROVIDER_SPEND_APPROVED=true only alongside the recorded
 *     spend approval; xAI additionally requires §20.13.
 *  5. Configure the private storage bucket for uploads and export
 *     artifacts (FR-4/FR-8 storage paths).
 *
 * What already works against a plain PostgreSQL 16 server with ZERO
 * external credentials (integration-tested): the full data adapter minus
 * run execution and signed uploads, the wallet-balance read, catalog and
 * estimates. Run execution stays refused until providers + the durable job
 * runner are approved and deployed.
 */
export function createProductionAdapters(): Adapters {
  const env = getEnv();
  if (env.LEX_APP_MODE !== "production") {
    throw new Error("createProductionAdapters requires LEX_APP_MODE=production.");
  }
  // getEnv() has already validated the required production variables.
  const pool = getPool(env.LEX_DATABASE_URL!);
  return {
    auth: new SupabaseAuthAdapter(
      pool,
      supabaseTokenVerifier(env.LEX_SUPABASE_URL!, env.LEX_SUPABASE_ANON_KEY!),
    ),
    data: new PgDataAdapter(pool),
    billing: new PgBillingAdapter(pool),
    modelGateway: new ProviderGatewayAdapter(),
  };
}
