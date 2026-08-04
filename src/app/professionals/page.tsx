import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "For professionals — Lex Patent Studio",
  description:
    "For solo patent attorneys and agents: associate-tier throughput under your supervision, with verification you can check instead of trust.",
};

export default function ProfessionalsPage() {
  return (
    <CapabilityPage
      kicker="Audience / Professionals"
      title="Delegate the associate work. Keep the judgment."
      lede="Section drafting, claim trees with fallbacks, rejection mapping, IDS preparation, search reports, research memos — prepared for your review the way you'd brief a junior associate, at a fraction of a junior associate's fully loaded cost."
      rows={[
        {
          title: "Trust, but verify — literally",
          text: "Every proposition cites retrievable authority with effective dates or is labeled analysis. Quotes are verified against source text. Unsupported statements are flagged, not smoothed over.",
        },
        {
          title: "Absolute matter isolation",
          text: "Retrieval, prompts, caches, logs, analytics — nothing learned in one matter ever surfaces in another. Each client matter is its own sealed record.",
        },
        {
          title: "Your style, enforced",
          text: "Personal or firm drafting-style profiles apply to everything Lex produces, and your playbook stays yours: tenant-isolated, hash-chained, immutable once published.",
        },
        {
          title: "Cost before every run",
          text: "Pick the reasoning engine per task and see the estimated charge range and wallet balance before executing. Charges are provider cost × 2.0 for generation tasks and × 1.5 for analysis tasks, disclosed before the run — no surprises.",
        },
      ]}
      boundary="The comparison to associate throughput is economic and workflow-based — never a claim of attorney equivalence or autonomous legal judgment. You review all work, control client communications, and own every signature, deadline, and filing."
      next={{ href: "/pricing", label: "See Professional pricing" }}
    />
  );
}
