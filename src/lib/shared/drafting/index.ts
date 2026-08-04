/**
 * Shared three-pass drafting core (Jeff's directive, 2026-08-04).
 *
 * PASS_1_DRAFTING → FIGURES_PENDING → FIGURES_READY → PASS_2_REVISING
 *                 → READY_FOR_REVIEW  (+ NEEDS_INPUT / PAUSED_BUDGET / FAILED)
 *
 * Everything here is product-agnostic. wepatent and Lex Patent Studio both
 * consume this module and differ only through `DraftProductConfig`.
 */
export * from "./pass-state";
export * from "./illustrations-brief";
export * from "./author-brief";
export * from "./reconcile";
export * from "./delivery-gate";
export * from "./product-config";
