import type { Metadata } from "next";
import SelfServiceConsent from "./SelfServiceConsent";

export const metadata: Metadata = {
  title: "wepatent | Counsel-ready invention records",
  description: "Organize invention facts and create working drafts for review and approval by qualified patent counsel.",
};

const audiences = [
  ["Founders", "Capture what changed, who contributed, what was disclosed, and what counsel needs next."],
  ["VCs", "Give portfolio companies a consistent, counsel-ready invention and ownership record before diligence."],
  ["R&D teams", "Turn laboratory notes, design decisions, and contributor histories into reviewable invention records."],
  ["Innovation leaders", "Create a repeatable invention-intake process without pretending software makes legal decisions."],
];

export default function WepatentHome() {
  return (
    <div className="venture-site">
      <header className="venture-header">
        <a className="venture-wordmark" href="#wepatent-top" aria-label="wepatent home"><span>wp</span> wepatent</a>
        <nav aria-label="Primary navigation"><a href="#audiences">Who it helps</a><a href="#boundary">Software and counsel</a><a href="#start">Start</a></nav>
        <a className="button venture-button button-small" href="#start">Build your record</a>
      </header>

      <main id="wepatent-top">
        <section className="venture-hero">
          <div><p className="venture-kicker">For founders, VCs, R&D, and innovation teams</p><h1>Turn invention work into counsel-ready materials.</h1><p className="venture-lede">Organize technical facts, contributors, source documents, and disclosure history. Generate clearly labeled working drafts. Bring a better record to qualified patent counsel.</p><div className="hero-actions"><a className="button venture-button" href="#start">Create an invention record</a><a className="text-link" href="#boundary">See what counsel must decide <span aria-hidden="true">→</span></a></div></div>
          <aside className="record-card" aria-label="Invention record preview"><span className="record-tag">Working record · not legal advice</span><h2>Battery enclosure cooling system</h2><dl><div><dt>Contributors</dt><dd>4 identified</dd></div><div><dt>Disclosure history</dt><dd>2 events to confirm</dd></div><div><dt>Technical sources</dt><dd>11 organized</dd></div><div><dt>Draft status</dt><dd>Counsel review required</dd></div></dl></aside>
        </section>

        <section className="venture-section" id="audiences"><p className="venture-kicker">One invention record, four business moments</p><h2>Capture the facts before a filing or diligence sprint forces the issue.</h2><div className="audience-grid">{audiences.map(([title, text]) => <article key={title}><span aria-hidden="true">↗</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>

        <section className="boundary-grid" id="boundary"><div className="software-side"><p className="venture-kicker">What wepatent can do</p><h2>Organize and prepare.</h2><ul><li>Structure user-provided invention facts</li><li>Flag missing contributors and timeline details</li><li>Assemble source-linked working drafts</li><li>Prepare questions and materials for counsel</li></ul></div><div className="lawyer-side"><p className="venture-kicker">What qualified counsel must do</p><h2>Advise and approve.</h2><ul><li>Evaluate patentability and filing strategy</li><li>Determine inventorship, ownership, and deadlines</li><li>Review and revise claims and legal documents</li><li>Approve reliance, signatures, and any filing</li></ul></div></section>

        <section className="venture-section start-section" id="start"><SelfServiceConsent /></section>
      </main>

      <footer className="venture-footer"><span>wepatent — self-service invention documentation</span><span>Not a law firm · Not legal advice · Counsel review required</span><a href="/wepatent/terms">Self-Service Terms</a></footer>
    </div>
  );
}
