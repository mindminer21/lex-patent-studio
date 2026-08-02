const workflows = [
  ["Draft", "Application work product", "Move from an approved fact record to specifications, claims, and filing-paper drafts."],
  ["Respond", "Prosecution analysis", "Map rejections, references, amendments, and argument options with a reviewable source trail."],
  ["Research", "Primary-authority memos", "Build cited research from public patent authorities with effective dates and source status."],
  ["Review", "A second set of eyes", "Run model critique and deterministic checks before the responsible practitioner approves the work."],
];

const professionalControls = [
  "Practitioner-owned fact and source record",
  "Citation, quotation, and support verification",
  "Versioned drafts and approval status",
  "Model choice with cost shown before each run",
  "Tenant isolation, retention controls, and audit history",
];

const plans = [
  ["Professional", "$149", "For solo patent attorneys and agents"],
  ["Team", "$499", "For boutiques and in-house patent teams"],
  ["Enterprise", "Custom", "For firms needing SSO, DPA, and custom retention"],
];

export default function Home() {
  return (
    <div className="site-shell professional-site">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Lex Patent Studio home">
          <span className="wordmark-mark">L</span>
          <span>Lex Patent Studio</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/product">Product</a>
          <a href="/pricing">Pricing</a>
          <a href="/models">Models</a>
          <a href="/security">Security</a>
        </nav>
        <a className="button button-small" href="/app">Open the workspace</a>
      </header>

      <main id="top">
        <section className="hero professional-hero">
          <div className="hero-copy">
            <p className="kicker">Patent work moves faster with a prepared first draft</p>
            <h1>Your next patent associate.</h1>
            <p className="lede">
              A source-grounded patent drafting, prosecution, and strategy workspace for law firms and in-house counsel. You direct the work. Lex organizes the record, drafts, checks, and cites.
            </p>
            <div className="hero-actions">
              <a className="button" href="#pricing">Add Lex to your team</a>
              <a className="text-link" href="#work">See the workbench <span aria-hidden="true">→</span></a>
            </div>
            <p className="boundary-note">Lex is software—not a licensed person, attorney, patent agent, employee, or substitute for professional judgment. The responsible practitioner independently reviews all work and controls advice, client communications, deadlines, signatures, and filings.</p>
          </div>
          <aside className="workbench-preview" aria-label="Professional workspace concept preview">
            <div className="preview-header"><span>Matter / Adaptive fastener</span><span className="status">Attorney review</span></div>
            <div className="preview-grid">
              <div className="preview-rail"><span className="preview-label">Matter record</span><strong>Facts</strong><span>Sources</span><span>Claims</span><span>Documents</span></div>
              <div className="preview-document"><span className="preview-label">Associate workbench</span><h2>Independent claim strategy</h2><p>Three supported claim concepts, two unresolved facts, and a citation-linked fallback map are ready for practitioner review.</p><div className="draft-line long" /><div className="draft-line" /><div className="draft-line medium" /></div>
              <div className="preview-sources"><span className="preview-label">Quality control</span><strong>6 sources verified</strong><span>2 facts need confirmation</span><span>Draft · not approved</span></div>
            </div>
          </aside>
        </section>

        <section className="section" id="work">
          <div className="section-heading"><p className="kicker">Delegate the first pass</p><h2>Give Lex the work you would give a capable associate—then keep the judgment.</h2></div>
          <div className="workflow-list">
            {workflows.map(([eyebrow, title, text], index) => (
              <article className="workflow-row" key={title}><span className="row-index">0{index + 1}</span><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div><p>{text}</p></article>
            ))}
          </div>
        </section>

        <section className="counsel-section" id="control">
          <div className="counsel-copy"><p className="kicker">Built for supervision</p><h2>The practitioner remains in command.</h2><p>Lex prepares reviewable work product and a traceable record. It does not accept engagements, give advice to your client, sign, docket, certify, or file.</p><a className="button button-light" href="#pricing">Review the professional plans</a></div>
          <ul className="counsel-steps professional-controls">
            {professionalControls.map((control, index) => <li key={control}><span>{String(index + 1).padStart(2, "0")}</span>{control}</li>)}
          </ul>
        </section>

        <section className="section pricing-section" id="pricing">
          <div className="section-heading"><p className="kicker">Professional pricing</p><h2>More capacity without adding a seat to payroll.</h2></div>
          <div className="pricing-table" role="table" aria-label="Professional pricing plans">
            {plans.map(([name, price, detail]) => <article className="plan" key={name} role="row"><div><p className="eyebrow">{name}</p><p>{detail}</p></div><p className="price"><strong>{price}</strong>{price !== "Custom" && <span>/month</span>}</p><a className="text-link" href="mailto:demo@example.com?subject=Lex%20Patent%20Studio%20demo">Request details <span aria-hidden="true">→</span></a></article>)}
          </div>
          <p className="pricing-note">AI usage is billed separately at provider cost × 1.50 through a prepaid wallet. Pricing is a design-stage hypothesis for professional validation.</p>
        </section>
      </main>

      <footer>
        <span>Lex Patent Studio — professional patent workbench</span>
        <nav aria-label="Legal" style={{ display: "flex", gap: 20 }}>
          <a href="/security" style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>Security</a>
          <a href="/legal" style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>Legal</a>
          <a href="/legal/ai-disclosure" style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>AI disclosure</a>
        </nav>
      </footer>
    </div>
  );
}
