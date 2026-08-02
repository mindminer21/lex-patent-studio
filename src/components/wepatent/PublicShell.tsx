import Link from "next/link";
import type { ReactNode } from "react";

const NAV_LINKS: Array<[string, string]> = [
  ["/wepatent/pricing", "Pricing"],
  ["/wepatent/security", "Security"],
  ["/wepatent/ai-disclosure", "AI disclosure"],
  ["/wepatent/terms", "Terms"],
];

/**
 * Shared public chrome for every wepatent marketing/policy page.
 * wepatent's identity is deliberately plain and separate from Lex Patent
 * Studio: no professional-lane branding or "associate" language appears here.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="venture-site">
      <header className="venture-header">
        <Link className="venture-wordmark" href="/wepatent" aria-label="wepatent home">
          <span>wp</span> wepatent
        </Link>
        <nav aria-label="Primary navigation">
          {NAV_LINKS.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <Link className="button venture-button button-small" href="/wepatent/sign-in">
          Sign in
        </Link>
      </header>
      <main>{children}</main>
      <footer className="venture-footer">
        <span>wepatent — self-service invention documentation</span>
        <span>Not a law firm · Not legal advice · Counsel review required</span>
        <nav aria-label="Legal" className="venture-footer-nav">
          <Link href="/wepatent/terms">Terms</Link>
          <Link href="/wepatent/privacy">Privacy</Link>
          <Link href="/wepatent/ai-disclosure">AI disclosure</Link>
          <Link href="/wepatent/security">Security</Link>
        </nav>
      </footer>
    </div>
  );
}
