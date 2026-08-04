/**
 * PER-PRODUCT CONFIGURATION for the shared three-pass drafting flow.
 *
 * Jeff's directive (2026-08-04): "the state machine, the illustrations-brief
 * schema, the numeral registry, the reconciliation checks, and the
 * pass-orchestration jobs live in SHARED code with per-product configuration
 * (prompt policy, tier rules, output document shape, review UX). ... Do not
 * fork the logic."
 *
 * This module is the ONLY place the two products are allowed to differ. If
 * something is not expressible as a field here, it does not belong in a
 * product-specific branch of the orchestrator — it belongs in this type.
 */
import type { BillingCategory } from "../billing/markup";

export type DraftProduct = "wepatent" | "lex";

/** Work tiers, mirrored from Lex's model so this module stays standalone. */
export type DraftWorkTier = "A" | "B" | "C";

export type DraftProductConfig = {
  product: DraftProduct;

  /* ---------------------------- output shape --------------------------- */
  /**
   * The sections the drafted document carries, in order. wepatent produces
   * a counsel-ready disclosure package; Lex produces a practitioner draft
   * that additionally carries claim-support material per its PRD.
   */
  documentSections: readonly string[];
  /** Lex only: Pass 1 also produces claim-support material (PRD §8.2). */
  includeClaimSupport: boolean;
  /** What the finished package is called in product copy. */
  deliverableLabel: string;

  /* ----------------------------- tier rules ---------------------------- */
  /**
   * The work tier the drafting passes run at. Lex drafting is **Tier B —
   * draft for review**: a responsible practitioner reviews and edits before
   * any downstream use, and the output enters the review queue. wepatent
   * has no tier model, so this is null there.
   */
  tier: DraftWorkTier | null;
  /** Lex only: completed sets enter the practitioner review queue. */
  entersReviewQueue: boolean;

  /* --------------------------- prompt policy --------------------------- */
  promptPolicy: {
    /**
     * The standing instruction prefixed to both passes. The two products
     * draft for different readers and must not borrow each other's voice.
     */
    systemPreamble: string;
    /**
     * The honesty bar. Identical in substance across products — where the
     * record is insufficient, ask rather than invent — but each states it
     * in its own register.
     */
    insufficiencyRule: string;
    /** Whether prose may cite public-corpus references. */
    allowCorpusCitations: boolean;
  };

  /* ------------------------------ review UX ---------------------------- */
  reviewUx: {
    /** Route the user lands on to review the set. `:id` is substituted. */
    reviewPath: string;
    /** Route that shows the Pass 1 ↔ Pass 2 diff. */
    diffPath: string;
    /** The verb on the accept control. */
    acceptLabel: string;
  };

  /* ------------------------------- metering ---------------------------- */
  /**
   * Both passes author work product delivered to the customer, so both are
   * GENERATION tasks (2.0×). Stated per product so a future divergence is a
   * config change with a reviewer, not a silent drift.
   */
  passOneBillingCategory: BillingCategory;
  passTwoBillingCategory: BillingCategory;
};

/** wepatent: the counsel-ready disclosure package. */
export const WEPATENT_DRAFT_CONFIG: DraftProductConfig = {
  product: "wepatent",
  documentSections: [
    "Background",
    "Summary",
    "Brief Description of the Drawings",
    "Detailed Description",
  ],
  includeClaimSupport: false,
  deliverableLabel: "counsel-ready disclosure package",
  tier: null,
  entersReviewQueue: false,
  promptPolicy: {
    systemPreamble:
      "You are preparing an invention-disclosure working draft for review by qualified patent counsel. You are not counsel, you do not give legal advice, and nothing you write is a legal opinion. Write from the approved record only.",
    insufficiencyRule:
      "Where the record does not support a statement, do not invent one. Ask a targeted question instead and leave the point open.",
    allowCorpusCitations: true,
  },
  reviewUx: {
    reviewPath: "/wepatent/app/inventions/:id/review",
    diffPath: "/wepatent/app/inventions/:id/drafts",
    acceptLabel: "Accept for counsel package",
  },
  passOneBillingCategory: "generation",
  passTwoBillingCategory: "generation",
};

/** Lex Patent Studio: the practitioner draft, Tier B, review-queue bound. */
export const LEX_DRAFT_CONFIG: DraftProductConfig = {
  product: "lex",
  documentSections: [
    "Field",
    "Background",
    "Summary",
    "Brief Description of the Drawings",
    "Detailed Description",
    "Claim support",
  ],
  includeClaimSupport: true,
  deliverableLabel: "practitioner draft",
  /**
   * Tier B — draft for review (PRD-lex §5.3). Drafting is substantive work
   * product: the responsible practitioner reviews and edits before any
   * downstream use. The three-pass flow does not change the tier, and the
   * tier floor may be promoted but never demoted (Invariant 15).
   */
  tier: "B",
  entersReviewQueue: true,
  promptPolicy: {
    systemPreamble:
      "You are drafting for a licensed patent practitioner who will review and edit before any downstream use. Draft from the counsel-approved fact ledger only. Do not assert unverified reference content.",
    insufficiencyRule:
      "Where the approved fact ledger does not support a statement, leave it open and flag it for the practitioner. Never fill a gap with plausible text.",
    allowCorpusCitations: true,
  },
  reviewUx: {
    reviewPath: "/app/matters/:id/reviews",
    diffPath: "/app/matters/:id/documents",
    acceptLabel: "Accept into review queue",
  },
  passOneBillingCategory: "generation",
  passTwoBillingCategory: "generation",
};

export const DRAFT_PRODUCT_CONFIGS: Readonly<Record<DraftProduct, DraftProductConfig>> = {
  wepatent: WEPATENT_DRAFT_CONFIG,
  lex: LEX_DRAFT_CONFIG,
};

export function draftConfigFor(product: DraftProduct): DraftProductConfig {
  return DRAFT_PRODUCT_CONFIGS[product];
}

/** Substitute the record id into a configured review route. */
export function resolveReviewPath(config: DraftProductConfig, recordId: string): string {
  return config.reviewUx.reviewPath.replace(":id", recordId);
}

export function resolveDiffPath(config: DraftProductConfig, recordId: string): string {
  return config.reviewUx.diffPath.replace(":id", recordId);
}
