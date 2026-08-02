"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// §8.2 route order: chat, facts, sources, workflows, documents, claims,
// citations, reviews, counsel, activity — plus the composer workspace.
const TABS = [
  { slug: "", label: "Workspace" },
  { slug: "chat", label: "Chat" },
  { slug: "facts", label: "Facts" },
  { slug: "sources", label: "Sources" },
  { slug: "workflows", label: "Workflows" },
  { slug: "documents", label: "Documents" },
  { slug: "claims", label: "Claims" },
  { slug: "citations", label: "Citations" },
  { slug: "reviews", label: "Reviews" },
  { slug: "counsel", label: "Counsel" },
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
