import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Portfolio analysis — Lex Patent Studio",
  description:
    "Cross-matter status dashboards, coverage-gap signals, and advisory filing priorities — role-gated, and never a docketing system of record.",
};

export default function PortfolioAnalysisPage() {
  return (
    <CapabilityPage
      kicker="Product / Portfolio analysis"
      title="Status you can defend in a budget meeting."
      lede="Family status, coverage-gap signals, and filing-priority ordering across every matter in your tenant — computed from your own record, visible only to practitioner roles."
      rows={[
        {
          title: "Cross-matter dashboards",
          text: "Approved-fact coverage, claim counts, run activity, pending reviews by tier, and export status per matter, in one place.",
        },
        {
          title: "Coverage-gap signals",
          text: "Deterministic signals — no approved baseline, no claim set, work product never exported — that point at process gaps, not legal conclusions.",
        },
        {
          title: "Advisory priorities",
          text: "Matters order by soonest observed date and review backlog. Every date carries the same disclaimer as everywhere else: verify against your docket.",
        },
        {
          title: "Audit evidence per matter",
          text: "Every AI-assisted work product traces to its run, model, corpus release, checks, and approvals — the trail your CFO and your clients can both live with.",
        },
      ]}
      boundary="Lex Patent Studio is not a docketing system of record and does not guarantee deadline monitoring. Portfolio views are status observations over your tenant's own data — nothing is ever compared across tenants."
      next={{ href: "/product/prepare-and-file", label: "Next: prepare & file" }}
    />
  );
}
