import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Prepare & file — Lex Patent Studio",
  description:
    "Export-ready, USPTO-formatted work product with version-locked manifests. Filing stays human: Lex prepares, your practitioner files.",
};

export default function PrepareAndFilePage() {
  return (
    <CapabilityPage
      kicker="Product / Prepare & file"
      title="Preparation to the last yard. The filing is yours."
      lede="USPTO-formatted DOCX and PDF exports, review checklists, source indexes, and SHA-256 manifests locked to the exact approved version. No code path files, signs, or talks to the Patent Center."
      rows={[
        {
          title: "USPTO-ready formatting",
          text: "Times New Roman 12pt, double-spaced, 1.5-inch left margin, MPEP-style amendment markup — the formatting conventions handled before review, not after.",
        },
        {
          title: "Version-locked manifests",
          text: "Every export carries checksums, model identity, corpus release, verification results, and the approval record. Later edits create new versions; exported artifacts never mutate.",
        },
        {
          title: "Watermark until a human approves",
          text: "Unapproved exports say DRAFT — NOT REVIEWED on every page. Approval by an authenticated practitioner is the only thing that removes it.",
        },
        {
          title: "IDS packets with SB/08 validation",
          text: "Reference extraction, citation classification, and field validation for Patent Center autoload — prepared for your review and your submission.",
        },
        {
          title: "Filing needs? Connected counsel",
          text: "When work needs a filing practitioner, route it through the separately gated connected-counsel pathway — conflict intake, attorney acceptance, and a signed engagement before anything substantive moves.",
        },
      ]}
      boundary="The platform never signs, certifies, files, communicates with the USPTO, or communicates with an end client on anyone's behalf. Export and preparation only — the responsible practitioner reviews, signs, and files."
      next={{ href: "/patent-counsel", label: "Meet with patent counsel" }}
    />
  );
}
