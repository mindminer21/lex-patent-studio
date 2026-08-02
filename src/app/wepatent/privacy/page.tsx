import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";

export const metadata: Metadata = {
  title: "Draft Privacy Policy | wepatent",
  description: "Design-stage privacy policy architecture for wepatent.",
};

const sections = [
  ["What we collect", "Account information (name, email, organization), billing records handled by the payment processor, invention records and uploads you choose to store, terms-acceptance records, and limited security and operational logs. Operational logs are designed to exclude prompt content, document contents, and unnecessary personal information."],
  ["How invention content is used", "Invention content is used only to provide the service to your organization: storing records, running the generations you request, and producing the exports you create. Customer content is not used to train foundation models and is not shared across organizations."],
  ["AI providers and subprocessors", "Generation requests are sent through a server-side gateway to the model providers identified in the AI Disclosure under terms that restrict training on your content. A complete subprocessor list with processing locations must be published before launch."],
  ["Not privileged; not a client relationship", "Information you enter into the self-service product is not protected by attorney-client privilege and does not make you a client of any law firm. If you request a counsel consultation, only the limited conflict-intake information you approve is shared, and only under the counsel-request flow."],
  ["Retention and deletion", "Organizations control retention settings. You can delete records, and deletion workflows are designed to remove content from active systems and schedule purge from backups, subject to legal-hold requirements that will be documented before launch."],
  ["Security", "See the Security overview for the engineering design: tenant isolation with row-level security, encryption in transit and at rest, least-privilege access, and audit logging."],
  ["Your choices and rights", "Depending on your jurisdiction you may have rights to access, correct, delete, or export personal information. The launch policy must document how to exercise these rights and the applicable state or federal privacy frameworks."],
];

export default function PrivacyPage() {
  return (
    <PublicShell>
      <div className="policy-page">
        <p className="venture-kicker">Design-stage draft · not an approved launch policy</p>
        <h1>Draft Privacy Policy</h1>
        <p className="terms-intro">
          This draft describes how wepatent is designed to handle personal information and invention content.
          It requires privacy-counsel review, a verified subprocessor list, and technical verification of every
          statement before publication.
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
            <Link href="/wepatent/ai-disclosure">AI Disclosure</Link> ·{" "}
            <Link href="/wepatent/security">Security overview</Link>
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
