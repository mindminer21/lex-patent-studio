import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Resources — Lex Patent Studio",
  description:
    "How Lex is built: the knowledge system, the verification pipeline, the tier model, and the boundaries the product enforces in code.",
};

export default function ResourcesPage() {
  return (
    <CapabilityPage
      kicker="Resources"
      title="How the workbench earns trust."
      lede="No customer logos, no invented metrics, no benchmark theater. These are the mechanisms — each one visible in the product and testable in the audit trail."
      rows={[
        {
          title: "The knowledge system",
          text: "A license-gated public corpus: section-level MPEP and statutes with point-in-time editions, authority feeds, public patent data, and a citation graph for supersession checks. Sources without a commercial-clear license class are unreachable by design.",
        },
        {
          title: "The verification pipeline",
          text: "Hybrid retrieval with authority weighting and required as-of dating; verbatim quote verification; second-model critique by a different engine; deterministic claim, antecedent-basis, numeral, and SB/08 checks.",
        },
        {
          title: "The tier model",
          text: "Tier A prepare, Tier B draft-for-review, Tier C decision-support-only. Tiers are platform policy with a non-demotable floor, shown on every output, export, and audit event.",
        },
        {
          title: "Substantiation before claims",
          text: "Any public performance or throughput claim must map to evaluation evidence from the release-gate harness and attorney-validated benchmarks. Until then, we don't make the claim.",
        },
      ]}
      boundary="Every quality and performance statement on this site is bounded by the evaluation program: workflows ship only after passing their release gates, and public claims cite attorney-validated results only."
      next={{ href: "/models", label: "See the model catalog" }}
    />
  );
}
