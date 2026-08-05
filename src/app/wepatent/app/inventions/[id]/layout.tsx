import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAdapters } from "@/lib/server/adapters";
import { isInventionRecordEmpty } from "@/lib/server/services/record-emptiness";
import { requireOnboarded } from "@/lib/server/session";

/**
 * Record navigation — five tabs (Jeff's approved set, 2026-08-04), reduced
 * from ten. Facts, Contributors, Timeline, Sources, and Review keep their
 * ROUTES and stay reachable contextually rather than through a tab:
 *
 * - Facts / Contributors / Timeline / Sources — the Overview "Record
 *   status" rows (each row already carries a "View" link), plus "All
 *   sources" and "add it as a fact" links inside the Studio panels.
 * - Review — folded into Drafts (the review is about the drafts), with the
 *   Overview "What counsel still decides" card also linking there.
 *
 * Nothing was deleted; deep links, existing links, and E2E navigation to
 * those routes keep working.
 */
const TABS: Array<[string, string]> = [
  ["", "Overview"],
  ["/studio", "Studio"],
  ["/drafts", "Drafts"],
  ["/figures", "Figures"],
  ["/export", "Export"],
];

export default async function InventionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  // A record with no content at all shows NO tab navigation — only the
  // Studio's single upload area and the guided-questions button (Jeff's
  // direction, 2026-08-04). The tabs return automatically as soon as any
  // content exists; there is no "continue" step.
  const empty = await isInventionRecordEmpty(context.organization.id, id);

  return (
    <>
      <div className="wp-topbar">
        <h1>{invention.title}</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      <div className="wp-actions" style={{ marginBottom: 18 }}>
        <span className="wp-badge draft-label">Working record — counsel review required</span>
        {invention.synthetic && <span className="wp-badge synthetic">Synthetic example data</span>}
      </div>
      {!empty && (
        <nav
          className="wp-nav"
          aria-label="Invention record sections"
          style={{ display: "flex", flexWrap: "wrap", marginBottom: 22 }}
        >
          {TABS.map(([suffix, label]) => (
            <Link key={label} href={`/wepatent/app/inventions/${invention.id}${suffix}`}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </>
  );
}
