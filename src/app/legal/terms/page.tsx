import type { Metadata } from "next";
import { LegalStub } from "@/components/marketing/LegalStub";

export const metadata: Metadata = { title: "Terms of service — Lex Patent Studio" };

export default function TermsPage() {
  return (
    <LegalStub
      kicker="Legal / Terms of service"
      title="Terms of service."
      lede="Professional-lane subscription terms for supervised patent professionals."
      positions={[
        "Users represent that they are, or work under the supervision of, a responsible practitioner; all outputs are drafts requiring professional review before any use.",
        "The platform provides software, not legal services; no attorney–client relationship is created with the platform.",
        "The platform never signs, certifies, files, or communicates with the USPTO or with end clients on a user's behalf.",
        "Lex Patent Studio is not a docketing system of record and does not guarantee deadline monitoring; every surfaced date must be verified against the user's docket.",
        "Work-tier labels and review requirements are platform policy and cannot be removed or demoted below the platform floor.",
        "Usage billing is prepaid-wallet based at published, effective-dated rates set by task type — provider cost × 2.0 for generation tasks (work product newly authored for you: specification drafting in either pass, the illustrations brief, claim sets, office-action responses, declarations, memos, search reports, strategy briefs) and × 1.5 for analysis tasks (extraction, parsing, classification, transcription, retrieval, verification, coverage scoring, and routing) — reserved before execution and settled after.",
        "Customer content is never used to train models or improve any shared corpus.",
      ]}
    />
  );
}
