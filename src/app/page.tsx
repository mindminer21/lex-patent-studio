const counselSteps = [
  "Limited conflict intake",
  "Jeff reviews and clears or declines",
  "Consultation and scoped engagement",
  "Counsel-guided preparation",
  "Client and attorney approval",
  "Supervised filing and receipt",
];

const workflows = [
  {
    eyebrow: "Draft",
    title: "Invention disclosure to application",
    text: "Turn approved invention facts into structured, reviewable patent work product.",
  },
  {
    eyebrow: "Respond",
    title: "Office-action analysis",
    text: "Map rejections, cited references, proposed amendments, and response tradeoffs.",
  },
  {
    eyebrow: "Research",
    title: "Source-grounded strategy",
    text: "Research public patent authorities and records with exact citations and effective dates.",
  },
];

const plans = [
  ["Solo", "$49", "For inventors and occasional users"],
  ["Professional", "$149", "For patent attorneys and agents"],
  ["Team", "$499", "For boutiques and in-house teams"],
];

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Lex Patent Studio home">
          <span className="wordmark-mark">L</span>
          <span>Lex Patent Studio</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#counsel">Patent counsel</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <a className="button button-small" href="#workspace">Open workspace</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="kicker">Patent work product, with a clear path to counsel</p>
            <h1>Build the record. Shape the strategy. File with confidence.</h1>
            <p className="lede">
              A source-grounded patent drafting and analysis workspace with your choice of leading AI models—and a separate, conflict-checked path to meet patent counsel.
            </p>
            <div className="hero-actions">
              <a className="button" href="#workspace">Start a patent workspace</a>
              <a className="text-link" href="#counsel">Meet with patent counsel <span aria-hidden="true">→</span></a>
            </div>
            <p className="boundary-note">Self-service use does not create an attorney-client relationship. Legal services begin only after conflict clearance, attorney acceptance, and a signed engagement.</p>
          </div>
          <aside className="workbench-preview" id="workspace" aria-label="Workspace concept preview">
            <div className="preview-header">
              <span>Project / Adaptive fastener</span>
              <span className="status">Source-grounded</span>
            </div>
            <div className="preview-grid">
              <div className="preview-rail">
                <span className="preview-label">Matter record</span>
                <strong>Facts</strong>
                <span>Sources</span>
                <span>Claim tree</span>
                <span>Documents</span>
              </div>
              <div className="preview-document">
                <span className="preview-label">Draft workspace</span>
                <h2>Independent claim strategy</h2>
                <p>Review the approved fact ledger, map support, and compare fallback positions before drafting.</p>
                <div className="draft-line long" />
                <div className="draft-line" />
                <div className="draft-line medium" />
              </div>
              <div className="preview-sources">
                <span className="preview-label">Evidence</span>
                <strong>6 cited sources</strong>
                <span>2 facts need confirmation</span>
                <span>Current as of July 2026</span>
              </div>
            </div>
          </aside>
        </section>

        <section className="section" id="product">
          <div className="section-heading">
            <p className="kicker">The software lane</p>
            <h2>A working environment for patent professionals—not another generic chatbot.</h2>
          </div>
          <div className="workflow-list">
            {workflows.map((workflow, index) => (
              <article className="workflow-row" key={workflow.title}>
                <span className="row-index">0{index + 1}</span>
                <div>
                  <p className="eyebrow">{workflow.eyebrow}</p>
                  <h3>{workflow.title}</h3>
                </div>
                <p>{workflow.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="counsel-section" id="counsel">
          <div className="counsel-copy">
            <p className="kicker">The counsel lane</p>
            <h2>Meet with patent counsel to evaluate, prepare, and file.</h2>
            <p>Start with limited information for conflicts and suitability. Jeff is the initial connected patent lawyer. Substantive invention intake begins only after clearance and engagement.</p>
            <a className="button button-light" href="mailto:counsel@example.com?subject=Patent%20counsel%20request">Request a counsel consultation</a>
          </div>
          <ol className="counsel-steps">
            {counselSteps.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section className="section pricing-section" id="pricing">
          <div className="section-heading">
            <p className="kicker">Platform pricing</p>
            <h2>Subscription access, transparent model usage, separate legal fees.</h2>
          </div>
          <div className="pricing-table" role="table" aria-label="Pricing plans">
            {plans.map(([name, price, detail]) => (
              <article className="plan" key={name} role="row">
                <div>
                  <p className="eyebrow">{name}</p>
                  <p>{detail}</p>
                </div>
                <p className="price"><strong>{price}</strong><span>/month</span></p>
                <a className="text-link" href="#workspace">Choose {name} <span aria-hidden="true">→</span></a>
              </article>
            ))}
          </div>
          <p className="pricing-note">AI usage is billed at provider cost × 1.50 through a prepaid wallet. Connected-counsel legal fees and official filing fees are separately scoped and billed under the law firm engagement.</p>
        </section>
      </main>

      <footer>
        <span>Lex Patent Studio — design-stage prototype</span>
        <span>U.S. patent workflows only at initial launch</span>
      </footer>
    </div>
  );
}
