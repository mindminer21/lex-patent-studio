import type { Metadata } from "next";
import { LegalStub } from "@/components/marketing/LegalStub";

export const metadata: Metadata = { title: "Privacy policy — Lex Patent Studio" };

export default function PrivacyPage() {
  return (
    <LegalStub
      kicker="Legal / Privacy policy"
      title="Privacy policy."
      lede="How matter content and account data are handled."
      positions={[
        "All matter content is treated as highly sensitive: tenant- and matter-isolated storage under row-level security, encrypted in transit and at rest.",
        "Model providers process content under no-training, enterprise configurations with the shortest feasible retention; U.S. processing at launch.",
        "Subprocessors are documented and listed; a Data Processing Addendum is available for Team and Enterprise plans.",
        "No prompt bodies, matter content, or conflict metadata appear in analytics or error tracking.",
        "Tenants control retention and deletion of their matters; purged matters are removed from indexes and storage on a documented schedule.",
        "Platform processing is not represented as privileged communication; access controls support customers' own privilege workflows.",
      ]}
    />
  );
}
