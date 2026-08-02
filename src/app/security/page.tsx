import type { Metadata } from "next";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Security — Lex Patent Studio",
  description:
    "Confidentiality posture for patent work: tenant and matter isolation, no-training provider configurations, immutable audit, and export-control screening.",
};

const CONTROLS: Array<[string, string]> = [
  [
    "Matter isolation is absolute",
    "Retrieval, prompts, caches, logs, and analytics never mix matters or tenants. Matter-private retrieval uses only that matter's index; nothing learned in one matter surfaces in another.",
  ],
  [
    "Row-level security everywhere",
    "Every tenant-bearing table enforces row-level security, with service-boundary authorization checks on top. Cross-tenant and cross-matter isolation tests run in CI.",
  ],
  [
    "Your content never trains models",
    "Provider calls run under no-training, enterprise configurations with the shortest feasible retention and U.S. processing at launch. Subprocessors are documented; a DPA is available for Team and Enterprise plans.",
  ],
  [
    "Role policy is server-side",
    "Nine roles gate workflow invocation, approvals, exports, and visibility as server-side policy — not UI hiding. Contributor (R&D) seats cannot invoke generation, claim, prosecution, or research workflows.",
  ],
  [
    "Immutable audit trail",
    "Every material action records actor, role, timestamp, and subject. Review decisions carry the document-version hash they were made against. Per-matter audit export supports your own compliance needs.",
  ],
  [
    "Uploads are evidence, never instructions",
    "Documents pass validation, malware scanning, and quarantine before extraction. Retrieved content is structurally separated from system policy, and model output cannot trigger external actions.",
  ],
  [
    "Export-control screening",
    "Technology-category screening at matter creation; flagged categories (EAR/ITAR indicators) halt automated processing pending qualified human review, with no foreign inference routing.",
  ],
  [
    "No autonomous external action",
    "The platform never signs, certifies, files, communicates with the USPTO, or communicates with an end client on a user's behalf. Export and preparation only.",
  ],
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Security"
        title="Built for content you owe someone confidentiality on."
        lede="Patent work is presumptively sensitive. The platform treats every matter that way: isolated, access-controlled, audited, and never used to train models."
      />

      <section className="section" aria-label="Security controls">
        <div className="workflow-list">
          {CONTROLS.map(([title, text], index) => (
            <article className="workflow-row" key={title}>
              <span className="row-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{title}</h3>
              </div>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <Boundary>
        Privilege hygiene note: the platform makes no privilege claims, and
        platform processing is not itself a privileged communication. Legal-
        analysis artifacts are segregated and access-controlled to support
        your own privilege workflows — direction on privilege belongs to your
        counsel, not to software.
      </Boundary>
    </MarketingShell>
  );
}
