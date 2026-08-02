/**
 * Back-compat seam module: the production adapters now live in
 * src/lib/adapters/production/ (Postgres data adapter, Supabase Auth
 * verification, ledger-backed billing, provider gateway with approval-gated
 * liveness). See production/index.ts for the exact enabling actions.
 */
export { createProductionAdapters } from "./production";
