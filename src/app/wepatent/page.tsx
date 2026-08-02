import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";

export const metadata: Metadata = {
  title: "wepatent | Counsel-ready invention records",
  description:
    "Organize invention facts and create working drafts for review and approval by qualified patent counsel.",
};

const audiences = [
  ["Founders", "Capture what changed, who contributed, what was disclosed, and what counsel needs next."],
  ["VCs", "Give portfolio companies a consistent, counsel-ready invention and ownership record before diligence."],
  ["R&D teams", "Turn laboratory notes, design decisions, and contributor histories into reviewable invention records."],
  ["Innovation leaders", "Create a repeatable invention-intake process without pretending software makes legal decisions."],
];

const boundaries = [
  "wepatent is not a law firm and does not provide legal advice.",
  "Every generated document is an automated working draft that requires counsel review.",
  "Requesting a counsel consultation does not create representation.",
  "Representation begins only with conflict clearance and a signed engagement letter with an identified law firm.",
];

export default function WepatentHome() {
  return (
    <PublicShell>
      <section className="venture-hero" id="wepatent-top">
        <div>
          <p className="venture-kicker">For founders, VCs, R&D, and innovation teams</p>
          <h1>Turn invention work into counsel-ready materials.</h1>
          <p className="venture-lede">
            Organize technical facts, contributors, source documents, and disclosure history. Generate clearly
            labeled working drafts. Bring a better record to qualified patent counsel.
          </p>
          <div className="hero-actions">
            <Link className="button venture-button" href="/wepatent/sign-in">
              Create an invention record
            </Link>
            <Link className="text-link" href="#boundary">
              See what counsel must decide <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <aside className="record-card" aria-label="Invention record preview">
          <span className="record-tag">Working record · not legal advice</span>
          <h2>Battery enclosure cooling system</h2>
          <dl>
            <div>
              <dt>Contributors</dt>
              <dd>4 identified</dd>
            </div>
            <div>
              <dt>Disclosure history</dt>
              <dd>2 events to confirm</dd>
            </div>
            <div>
              <dt>Technical sources</dt>
              <dd>11 organized</dd>
            </div>
            <div>
              <dt>Draft status</dt>
              <dd>Counsel review required</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="venture-section" id="audiences">
        <p className="venture-kicker">One invention record, four business moments</p>
        <h2>Capture the facts before a filing or diligence sprint forces the issue.</h2>
        <div className="audience-grid">
          {audiences.map(([title, text]) => (
            <article key={title}>
              <span aria-hidden="true">↗</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="boundary-grid" id="boundary">
        <div className="software-side">
          <p className="venture-kicker">What wepatent can do</p>
          <h2>Organize and prepare.</h2>
          <ul>
            <li>Structure user-provided invention facts</li>
            <li>Flag missing contributors and timeline details</li>
            <li>Assemble source-linked working drafts</li>
            <li>Prepare questions and materials for counsel</li>
          </ul>
        </div>
        <div className="lawyer-side">
          <p className="venture-kicker">What qualified counsel must do</p>
          <h2>Advise and approve.</h2>
          <ul>
            <li>Evaluate patentability and filing strategy</li>
            <li>Determine inventorship, ownership, and deadlines</li>
            <li>Review and revise claims and legal documents</li>
            <li>Approve reliance, signatures, and any filing</li>
          </ul>
        </div>
      </section>

      <section className="venture-section start-section" id="start">
        <div className="consent-panel">
          <p className="venture-kicker">Before you begin</p>
          <h2>Know where the software stops—and counsel begins.</h2>
          <ul className="boundary-list">
            {boundaries.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="consent-legal">
            When you sign in, and before any substantive invention intake, you will be asked to expressly
            acknowledge these boundaries and accept the versioned{" "}
            <Link href="/wepatent/terms">Self-Service Terms</Link>. Acceptance is recorded server-side.
          </p>
          <Link className="button venture-button" href="/wepatent/sign-in">
            Sign in to get started
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
