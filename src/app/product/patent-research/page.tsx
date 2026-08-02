import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Patent research — Lex Patent Studio",
  description:
    "Primary-authority-first research memos with as-of dating, supersession checks, verified quotations, and explicit refusal when the record is insufficient.",
};

export default function PatentResearchPage() {
  return (
    <CapabilityPage
      kicker="Product / Patent research"
      title="Cited memos that a second reviewer can reproduce."
      lede="Issue decomposition, primary-authority retrieval, authority hierarchy, effective dates, supersession checks — and a full source trail so anyone can retrace every step."
      rows={[
        {
          title: "Primary law first",
          text: "Statutes and regulations rank ahead of guidance; MPEP passages are labeled as evidence of agency practice, never a substitute for controlling authority.",
        },
        {
          title: "As-of dating is a required parameter",
          text: "Every research run retrieves against a jurisdiction and as-of date. Superseded editions surface for point-in-time questions and are excluded from current-law answers.",
        },
        {
          title: "Verified quotations or labeled analysis",
          text: "Every quotation is checked verbatim against retrieved source text. A failure blocks verified status. Anything not grounded in a quotation is explicitly labeled analysis.",
        },
        {
          title: "Refusal over fabrication",
          text: "When the retrievable record cannot answer the question, the memo says so. No invented citations, patent numbers, or authority — ever.",
        },
      ]}
      boundary="Research memos are drafts for practitioner evaluation. The license-gated corpus serves public and expressly licensed sources only; sources without a commercial-clear license class are unreachable by design."
      next={{ href: "/product/portfolio-analysis", label: "Next: portfolio analysis" }}
    />
  );
}
