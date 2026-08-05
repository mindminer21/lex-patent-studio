"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Matter navigation — six tabs (Jeff's approved set, 2026-08-04), reduced
 * from eleven. Every §8.2 ROUTE still exists; Facts, Sources, Workflows,
 * Citations, and Counsel simply stopped being tabs and are reached from
 * the surface that already shows their content:
 *
 * - Facts    → the Workspace left pane's "Fact ledger" panel
 * - Sources  → the Workspace left pane's "Sources" panel
 * - Citations→ the Workspace right pane's "Citations · verification" panel
 * - Workflows→ the run composer's task picker
 * - Counsel  → the matter header (counsel status has no other home)
 */
const TABS = [
  { slug: "", label: "Workspace" },
  { slug: "chat", label: "Chat" },
  { slug: "documents", label: "Documents" },
  { slug: "claims", label: "Claims" },
  { slug: "reviews", label: "Reviews" },
  { slug: "activity", label: "Activity" },
] as const;

export function MatterTabs({ matterId }: { matterId: string }) {
  const pathname = usePathname();
  const base = `/app/matters/${matterId}`;

  return (
    <nav aria-label="Matter sections" className="mb-5 border-b border-[var(--line)]">
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = tab.slug
            ? pathname.startsWith(href)
            : pathname === base;
          return (
            <li key={tab.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-[0.88rem] font-semibold ${
                  active
                    ? "border-[var(--forest)] text-[var(--forest)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
