import type { Metadata } from "next";
import { CapabilityPage } from "@/components/marketing/CapabilityPage";

export const metadata: Metadata = {
  title: "Meet with patent counsel — Lex Patent Studio",
  description:
    "Evaluate, prepare & file with connected counsel through a gated pathway: conflict intake, attorney acceptance, and a signed engagement before representation.",
};

export default function PatentCounselPage() {
  return (
    <CapabilityPage
      kicker="Patent counsel"
      title="Meet with patent counsel — evaluate, prepare & file."
      lede="When work needs a filing practitioner — overflow, conflicts, or a matter that must be filed — route it to connected counsel through a pathway where every gate is explicit and nothing is implied."
      rows={[
        {
          title: "A request is not representation",
          text: "Creating a request, uploading materials, scheduling, or paying for software creates no attorney-client relationship. Your request shows a conspicuous NOT YET REPRESENTED status until an engagement is signed.",
        },
        {
          title: "Limited conflict intake first",
          text: "Counsel receives only limited conflict-check information before clearance — no substantive invention disclosure moves until the conflict and consent rules permit it.",
        },
        {
          title: "Explicit acceptance, separate engagement",
          text: "The attorney accepts or declines explicitly. Consultation is not engagement. Representation begins only with a signed engagement agreement with the identified law firm, with its own scope and fees.",
        },
        {
          title: "Supervised filing, human authorization",
          text: "Under an engagement, counsel-guided preparation and a supervised filing workflow follow — with attorney and client authorization as explicit hard gates. Legal fees are never platform revenue.",
        },
      ]}
      boundary="Connected-counsel intake is activated only after the platform's own approval gates (entity structure, engagement terms, counsel administration) are cleared. Until then this pathway is documented, not live."
    />
  );
}
