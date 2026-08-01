import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";

const TABS: Array<[string, string]> = [
  ["", "Overview"],
  ["/facts", "Facts"],
  ["/contributors", "Contributors"],
  ["/timeline", "Timeline"],
  ["/sources", "Sources"],
  ["/drafts", "Drafts"],
  ["/review", "Review"],
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
      <nav className="wp-nav" aria-label="Invention record sections" style={{ display: "flex", flexWrap: "wrap", marginBottom: 22 }}>
        {TABS.map(([suffix, label]) => (
          <Link key={label} href={`/app/inventions/${invention.id}${suffix}`}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
