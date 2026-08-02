import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Claim strategy — Lex Patent Studio",
  description:
    "Claim trees with planned-retreat fallbacks, deterministic dependency and antecedent-basis checks, and strategy selection recorded as a practitioner decision.",
};

export default function ClaimStrategyPage() {
  return (
    <CapabilityPage
      kicker="Product / Claim strategy"
      title="Fallback ladders you choose, checks that never blink."
      lede="Independent and dependent claim trees with planned-retreat fallback positions arrive as Tier-B drafts. The strategy skeleton you pick is recorded as a Tier-C decision — yours, not the model's."
      rows={[
        {
          title: "Claim trees with fallbacks",
          text: "WHAT/HOW separation and inventive-departure identification drive an independent/dependent tree with explicit retreat positions at every level.",
        },
        {
          title: "Deterministic checks, machine-readable results",
          text: "Claim-dependency, antecedent-basis, and reference-numeral consistency run as pure rules — never model opinion. Failures annotate the draft and cannot be dismissed without a recorded reason.",
        },
        {
          title: "Support mapping",
          text: "Written-description and enablement support checks map every claim term to specification support, so scope conversations start from evidence.",
        },
        {
          title: "Tier floor, not a suggestion",
          text: "Claim work ships at Tier B or above by platform policy. No role can demote it; your tenant can only make review stricter.",
        },
      ]}
      boundary="Claim scope and filing strategy are legal judgments. Lex proposes structures and shows check results; the responsible practitioner selects, edits, and approves every claim before it goes anywhere."
      next={{ href: "/product/office-actions", label: "Next: office actions" }}
    />
  );
}
