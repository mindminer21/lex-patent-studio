import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";
import { CURRENT_TERMS_VERSION } from "@/lib/domain/clickwrap";

export const metadata: Metadata = {
  title: "Draft Self-Service Terms | wepatent",
  description: "Design-stage terms architecture for the wepatent self-service product.",
};

const sections = [
  ["1. Self-service software; not a law firm", "wepatent is a software service for user-directed invention documentation and automated draft preparation. The software operator is not acting as your lawyer and does not provide legal advice, legal opinions, legal recommendations, or a review of legal sufficiency. The service is not a substitute for qualified patent counsel."],
  ["2. No attorney-client relationship or privilege", "Creating an account, paying software fees, entering information, generating or downloading a document, communicating with support, or requesting a counsel introduction does not create an attorney-client relationship. Self-service communications and uploads are not promised to be protected by attorney-client privilege. A legal representation begins only after conflicts and eligibility review, express acceptance by an identified attorney, and a signed engagement letter with the identified law firm."],
  ["3. Automated working drafts; counsel review required", "Outputs are automated working drafts. They may be inaccurate, incomplete, outdated, internally inconsistent, unsuitable for your jurisdiction, or harmful if used without professional review. You agree that patent-related draft documents must be reviewed and approved by qualified patent counsel before filing, disclosure, legal reliance, fundraising or diligence use, or other consequential action."],
  ["4. No deadlines, filings, or outcomes", "The self-service product does not monitor legal deadlines, make filing decisions, sign or file documents, determine inventorship or ownership, or guarantee patentability, validity, enforceability, freedom to operate, noninfringement, allowance, or any outcome. Laws and USPTO practice change and differ by jurisdiction and circumstances."],
  ["5. Your responsibilities", "You are responsible for the accuracy and completeness of information you provide, your authority to upload materials, safeguarding confidential and controlled information, obtaining professional advice, reviewing all outputs, monitoring deadlines, and deciding whether and how to use any material. You may not upload classified information, unlawfully disclosed third-party material, or export-controlled technical data contrary to the service policy."],
  ["6. AI and data limitations", "The service uses automated systems and third-party providers. The applicable Privacy Policy and AI Disclosure must identify provider handling, retention, training restrictions, subprocessors, security controls, deletion, and geographic processing. Do not assume that an AI-generated citation, quotation, patent number, deadline, or legal proposition is correct without verification."],
  ["7. Disclaimers of warranties", "To the fullest extent permitted by applicable law, the self-service product and outputs are provided on an “as is” and “as available” basis. Final terms should disclaim express and implied warranties, including merchantability, fitness for a particular purpose, title, noninfringement, accuracy, reliability, availability, and results, while preserving rights that cannot lawfully be waived."],
  ["8. Limits on liability", "Final terms should, to the fullest extent permitted by law, exclude indirect, incidental, special, exemplary, punitive, and consequential damages and establish a reasonable aggregate direct-damages cap tied to fees paid during a defined period. The clause must include conspicuous exceptions, state-specific savings language, and non-waivable consumer rights. It cannot be treated as protection for UPL, deception, professional discipline, gross negligence, or other non-waivable liability."],
  ["9. Indemnity for misuse", "Final terms may require users to defend and indemnify the operator against defined third-party claims arising from unlawful uploads, infringement of third-party rights, prohibited use, or material breach. It should not attempt to shift liability for the operator’s own non-waivable duties or misconduct."],
  ["10. Disputes and general terms", "Final terms must specify informal notice procedures, governing law and venue, any arbitration and class-action waiver, limitations periods, fees, opt-out rights if used, cancellation and refunds, changes to terms, assignment, severability, survival, and state- or customer-specific exceptions. These provisions require launch-jurisdiction review."],
];

export default function SelfServiceTerms() {
  return (
    <PublicShell>
      <div className="policy-page">
        <p className="venture-kicker">Design-stage legal architecture · not approved launch terms</p>
        <h1>Self-Service Terms and Required Counsel Review</h1>
        <p className="terms-intro">
          Terms version <strong>{CURRENT_TERMS_VERSION}</strong>. This prototype adapts the risk-control
          categories commonly used by self-service legal-technology providers, including LegalZoom, but uses
          original product-specific language. It must be reviewed by UPL/ethics, consumer-contract, privacy,
          and technology counsel before release.
        </p>
        <div className="terms-warning">
          <strong>Key requirement:</strong> wepatent is not a law firm and does not provide legal advice.
          Patent-related drafts must be reviewed and approved by qualified patent counsel before filing or
          consequential use.
        </div>
        <div className="terms-sections">
          {sections.map(([title, text]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{text}</p>
            </section>
          ))}
        </div>
        <section className="terms-source">
          <h2>Reference pattern</h2>
          <p>
            LegalZoom Terms of Use reviewed July 30, 2026:{" "}
            <a href="https://www.legalzoom.com/legal/general-terms/terms-of-use">
              legalzoom.com/legal/general-terms/terms-of-use
            </a>
            . The reference is used for clause categories, not copied language or an assumption of
            enforceability. See also the <Link href="/wepatent/privacy">Privacy Policy</Link> and{" "}
            <Link href="/wepatent/ai-disclosure">AI Disclosure</Link> drafts.
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
