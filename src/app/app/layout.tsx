import type { Metadata } from "next";
import Link from "next/link";
import { getAdapters } from "@/lib/adapters";
import { ROLE_LABELS } from "@/lib/domain/roles";
import { lexSignOutAction } from "@/app/login/actions";

export const metadata: Metadata = {
  title: "Workspace — Lex Patent Studio",
};

const NAV = [
  { href: "/app", label: "Home" },
  { href: "/app/matters", label: "Matters" },
  { href: "/app/review-queue", label: "Review queue" },
  { href: "/app/portfolio", label: "Portfolio" },
  { href: "/app/knowledge", label: "Knowledge" },
  { href: "/app/templates", label: "Templates" },
  { href: "/app/usage", label: "Usage" },
  { href: "/app/team", label: "Team" },
  { href: "/app/settings", label: "Settings" },
] as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex min-h-[60px] flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_94%,transparent)] px-4 py-2 backdrop-blur-md sm:px-6">
        <Link href="/" className="wordmark shrink-0">
          <span className="wordmark-mark">L</span>
          Lex Patent Studio
        </Link>
        <span className="border border-[#7d94ad] bg-[#e2ebf3] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#2c4763]">
          Local mode — synthetic data, no external services
        </span>
        <p className="m-0 hidden text-[0.72rem] leading-snug text-[var(--muted)] lg:block">
          Your next patent associate — always working under practitioner
          supervision. All outputs are drafts for professional review.
        </p>
        {session && (
          <div className="ml-auto flex min-w-0 max-w-full items-center gap-3 text-right text-[0.78rem] leading-tight">
          <span>
            <strong>{session.displayName}</strong>
            <br />
            <span className="text-[var(--muted)]">
              {ROLE_LABELS[session.role]} · {session.organizationName}
            </span>
          </span>
          {!session.synthetic && (
            <form action={lexSignOutAction}>
              <button className="text-xs font-semibold underline" type="submit">Sign out</button>
            </form>
          )}
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <nav
          aria-label="Workspace"
          className="hidden w-[196px] shrink-0 border-r border-[var(--line)] px-4 py-6 md:block"
        >
          <ul className="m-0 list-none space-y-1 p-0">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block px-2 py-2 text-[0.92rem] font-semibold hover:bg-[#eae6da]"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <nav
            aria-label="Workspace (mobile)"
            className="flex flex-wrap gap-x-4 gap-y-0 border-b border-[var(--line)] px-4 py-2 md:hidden"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="py-2 text-[0.9rem] font-semibold"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <main className="px-4 py-6 sm:px-6">{children}</main>
          <footer className="border-t border-[var(--line)] px-4 py-4 text-[0.72rem] leading-relaxed text-[var(--muted)] sm:px-6">
            Lex Patent Studio drafts, searches, analyzes, and prepares under
            practitioner supervision. It is not a lawyer, does not provide
            legal advice, never files or signs, and is not a docketing system
            of record. A responsible practitioner reviews, decides, signs, and
            files. All data in this workspace is synthetic demonstration
            content.
          </footer>
        </div>
      </div>
    </div>
  );
}
