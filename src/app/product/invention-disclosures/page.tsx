import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Invention disclosures — Lex Patent Studio",
  description:
    "Structured invention intake that turns interviews and uploads into a fact ledger with provenance, contributor attribution, and missing-fact prompts.",
};

export default function InventionDisclosuresPage() {
  return (
    <CapabilityPage
      kicker="Product / Invention disclosures"
      title="Intake that ends with facts, not folklore."
      lede="Structured interviews and disclosure uploads become a canonical fact ledger — problem, solution, components, steps, alternatives, advantages, contributors, dates — each fact carrying provenance and an owner."
      rows={[
        {
          title: "Structured interview or uploaded notes",
          text: "Run the guided interview live or feed in interview notes and transcripts. Lex extracts candidate facts and shows exactly where each one came from.",
        },
        {
          title: "Provenance on every fact",
          text: "user_asserted, source_supported, needs_confirmation, disputed, counsel_reviewed — the state is visible everywhere the fact is used, and only counsel-reviewed facts feed drafting.",
        },
        {
          title: "Missing-fact prompts to contributors",
          text: "Gaps and terminology conflicts become targeted follow-up questions routed to R&D contributor seats — who see intake and status, never legal analysis.",
        },
        {
          title: "An audit trail from day one",
          text: "Fact creation, edits, provenance changes, and approvals are immutable events with actor and timestamp, exportable for your own compliance needs.",
        },
      ]}
      boundary="Contributor seats are supervised, non-practitioner seats inside a legal team's tenant. Lex never converts intake into legal advice — the responsible practitioner approves the fact baseline before any drafting starts."
      next={{ href: "/product/application-drafting", label: "Next: application drafting" }}
    />
  );
}
