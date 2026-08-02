import Link from "next/link";

/**
 * Shared public-site shell (PRD §8.1) in the DESIGN-HANDOFF posture: warm
 * paper neutrals, deep ink/green, typography-led hierarchy, no gradients,
 * no fake metrics, no decorative AI imagery.
 *
 * Positioning rules (PRD §1) apply to every page rendered inside:
 * supervised-associate metaphor with qualifier; no attorney-equivalence,
 * no guaranteed outcomes, no "AI patent lawyer".
 */

const NAV = [
  { href: "/product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/models", label: "Models" },
  { href: "/security", label: "Security" },
] as const;

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell professional-site">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Lex Patent Studio home">
          <span className="wordmark-mark">L</span>
          <span>Lex Patent Studio</span>
        </Link>
        <nav aria-label="Primary navigation">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link className="button button-small" href="/app">
          Open the workspace
        </Link>
      </header>

      <main>{children}</main>

      <footer>
        <span>
          Lex Patent Studio — professional patent workbench
          <span className="block text-[0.72rem]">
            Software under practitioner supervision — not a lawyer, not legal
            advice, never files or signs.
          </span>
        </span>
        <nav aria-label="Legal" className="flex gap-5">
          <Link href="/security" className="underline underline-offset-4">
            Security
          </Link>
          <Link href="/legal" className="underline underline-offset-4">
            Legal
          </Link>
          <Link href="/legal/ai-disclosure" className="underline underline-offset-4">
            AI disclosure
          </Link>
        </nav>
      </footer>
    </div>
  );
}

export function PageIntro({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: string;
}) {
  return (
    <section className="border-b border-[var(--line)] px-[4vw] pb-14 pt-16">
      <p className="kicker">{kicker}</p>
      <h1
        className="m-0 max-w-[840px] font-medium"
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: "clamp(2.6rem, 5vw, 4.6rem)",
          lineHeight: 1.02,
          letterSpacing: "-0.04em",
        }}
      >
        {title}
      </h1>
      <p className="lede mt-6 max-w-[640px]">{lede}</p>
    </section>
  );
}

export function Boundary({ children }: { children: React.ReactNode }) {
  return (
    <p className="boundary-note mx-[4vw] my-10 max-w-[720px] border-l-4 border-[var(--forest)] pl-4">
      {children}
    </p>
  );
}
