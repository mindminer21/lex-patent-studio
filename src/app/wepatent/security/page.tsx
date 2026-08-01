import type { Metadata } from "next";
import PublicShell from "@/components/wepatent/PublicShell";

export const metadata: Metadata = {
  title: "Security | wepatent",
  description: "How wepatent is designed to handle invention data.",
};

const controls = [
  ["Tenant isolation", "Every private record belongs to exactly one organization. Row-level security policies and server-side authorization checks are designed so one organization can never read or change another organization’s records, and cross-tenant denial is covered by automated tests."],
  ["Invention content is treated as highly sensitive", "Invention details can include trade secrets and unpublished technical information. Content is encrypted in transit and at rest by the hosting providers, prompt content is excluded from operational logs, and access follows least privilege."],
  ["Separate data planes", "Private customer records and the public patent-authority corpus live in separate projects with separate credentials. Customer content is never mixed into shared retrieval or used to train foundation models."],
  ["Model providers behind a server gateway", "AI calls run only through a server-side gateway with per-workflow allowlists, token and cost caps, timeouts, and kill switches. Provider API keys and raw provider errors are never exposed to the browser."],
  ["Uploads are validated and quarantined", "File uploads are restricted by type and size, checked against magic bytes, scanned, and quarantined before processing. Instructions inside uploaded documents are treated as untrusted content, never as commands."],
  ["Auditability", "Security-relevant events carry correlation IDs across web, job, provider, and billing boundaries. Audit records are designed to be immutable from ordinary application roles."],
  ["Retention and deletion", "Organizations control retention settings, and deletion workflows are designed to produce audit evidence, including backup-purge scheduling."],
];

export default function SecurityPage() {
  return (
    <PublicShell>
      <div className="policy-page">
        <p className="venture-kicker">Data handling and security overview</p>
        <h1>Built to treat your invention like a secret worth keeping.</h1>
        <p className="terms-intro">
          This page describes the security design of wepatent. It is an engineering overview, not a
          certification. wepatent does not claim SOC 2, ISO 27001, HIPAA, or USPTO approval.
        </p>
        <div className="terms-sections">
          {controls.map(([title, text]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
            </section>
          ))}
        </div>
        <p className="prototype-note" role="note">
          Design-stage description. Final security documentation, independent assessment, and incident-response
          readiness are release gates before general availability.
        </p>
      </div>
    </PublicShell>
  );
}
