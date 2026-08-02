import "server-only";

/**
 * Subscription plan hypotheses (PRD FR-6). These are implementation
 * defaults for test-mode Stripe products, not permanent public promises —
 * changing live pricing, credits, markup, or wallet policy requires Jeff's
 * explicit approval. Provider rates never appear here or anywhere in
 * frontend source.
 */
export type BillingPlan = {
  id: string;
  displayName: string;
  monthlyFeeCents: number | null; // null = custom/contracted
  includedCreditCents: number | null;
  intendedCustomer: string;
  /** Purchasable through self-service Checkout (Enterprise is not). */
  selfService: boolean;
};

export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    id: "explore",
    displayName: "Explore",
    monthlyFeeCents: 0,
    includedCreditCents: 500,
    intendedCustomer: "Evaluation",
    selfService: false, // default plan; nothing to buy
  },
  {
    id: "solo",
    displayName: "Solo",
    monthlyFeeCents: 4_900,
    includedCreditCents: 1_000,
    intendedCustomer: "Individual founder or inventor",
    selfService: true,
  },
  {
    id: "professional",
    displayName: "Professional",
    monthlyFeeCents: 14_900,
    includedCreditCents: 3_000,
    intendedCustomer: "Startup or active invention team",
    selfService: true,
  },
  {
    id: "team",
    displayName: "Team",
    monthlyFeeCents: 49_900,
    includedCreditCents: 10_000,
    intendedCustomer: "R&D group, accelerator, or portfolio program",
    selfService: true,
  },
  {
    id: "enterprise",
    displayName: "Enterprise",
    monthlyFeeCents: null,
    includedCreditCents: null,
    intendedCustomer: "Larger organizations",
    selfService: false,
  },
];
