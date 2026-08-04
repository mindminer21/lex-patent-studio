/**
 * Compatibility re-export.
 *
 * The markup catalog is product-agnostic — Lex Patent Studio publishes the
 * same rate as wepatent — so it now lives in `src/lib/shared/billing/markup.ts`.
 * This module stays so the import paths that predate the move keep working;
 * it must never hold a second copy of any multiplier.
 */
export * from "@/lib/shared/billing/markup";
