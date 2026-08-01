import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";

export const metadata: Metadata = {
  title: "Draft AI Disclosure | wepatent",
  description: "How wepatent uses automated systems and third-party AI providers.",
};

const sections = [
  ["Automated systems, not a lawyer", "wepatent uses large language models and deterministic checks to help organize facts and produce working drafts. The software does not exercise legal judgment, is not a licensed person, and does not review outputs for legal sufficiency. Outputs are automated working drafts that require review and approval by qualified patent counsel before filing or consequential use."],
  ["Model providers", "Generation runs are routed server-side to third-party model providers — currently planned: OpenAI, Anthropic, and xAI — under enterprise terms that restrict training on customer content. The specific model used for each run is recorded and shown with the output."],
  ["What every output shows", "Each generated draft displays its draft status, the model identity, generation time, estimated and actual cost, the support status of underlying facts and sources, and the label “working draft — counsel review required.”"],
  ["Outputs can be wrong", "Model outputs may be inaccurate, incomplete, outdated, or internally inconsistent, and may fabricate citations. Do not rely on an AI-generated citation, patent number, date, deadline, or legal proposition without verification by qualified counsel."],
  ["Model output is untrusted", "Model output cannot change your fact record, approve itself, execute actions, or trigger filings. Only people can edit facts, and only qualified counsel review can mark material as counsel-reviewed."],
  ["Cost transparency", "AI usage is charged from a prepaid wallet at actual provider cost multiplied by 1.50, with effective-dated rates. Estimates and actuals are shown for every run."],
  ["Human review boundaries", "No automated output is filed with any patent office by wepatent. The product does not monitor deadlines and does not submit, sign, or certify documents."],
];

export default function AiDisclosurePage() {
  return (
    <PublicShell>
      <div className="policy-page">
        <p className="venture-kicker">Design-stage draft · provider and automated-system disclosure</p>
        <h1>Draft AI Disclosure</h1>
        <p className="terms-intro">
          This disclosure explains where automation is used in wepatent, which third-party providers are
          involved, and the limits you must understand before relying on any output.
        </p>
        <div className="terms-sections">
          {sections.map(([title, text]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
            </section>
          ))}
        </div>
        <section className="terms-source">
          <h2>Related documents</h2>
          <p>
            <Link href="/wepatent/terms">Self-Service Terms</Link> ·{" "}
            <Link href="/wepatent/privacy">Privacy Policy</Link> ·{" "}
            <Link href="/wepatent/security">Security overview</Link>
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
