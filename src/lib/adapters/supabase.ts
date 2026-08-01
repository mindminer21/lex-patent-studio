import type { Adapters } from "./types";

/**
 * Production adapter seam — Supabase (private application project) +
 * Stripe (billing) + server-side model gateway.
 *
 * TODO(Round 2+): implement against the environment contract in
 * src/lib/env. Requirements carried from the PRD:
 *
 *  - Supabase Auth sessions via HTTP-only cookies; organization_id and role
 *    derived from the authenticated session, never from client input
 *    (PRD-wepatent Invariant 6).
 *  - All queries under RLS (see supabase/migrations/); explicit
 *    authorization at the service boundary in addition to RLS.
 *  - Separate credentials for the public knowledge-corpus project
 *    (LEX_CORPUS_*); no cross-database joins (PRD §6.3).
 *  - Stripe reservation → settlement → wallet ledger with idempotency keys;
 *    charge = provider cost × 1.50 with effective-dated rates (FR-9).
 *  - Model gateway with provider adapters (OpenAI, Anthropic, xAI),
 *    allowlists, caps, kill switches; no provider key or raw provider error
 *    reaches the browser (FR-6). Provider enablement for customer traffic is
 *    approval-gated (PRD §20).
 *
 * This stub deliberately refuses to construct so no code path can reach a
 * live external service from Round 1.
 */
export function createProductionAdapters(): Adapters {
  throw new Error(
    "Production adapters are not implemented yet. Run with LEX_APP_MODE=local. " +
      "See TODO(Round 2+) notes in src/lib/adapters/supabase.ts.",
  );
}
