"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<[string, string]> = [
  ["/app", "Dashboard"],
  ["/app/inventions/new", "New invention"],
  ["/app/counsel", "Counsel requests"],
  ["/app/billing", "Billing"],
  ["/app/settings", "Settings"],
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="wp-nav" aria-label="Application">
      {LINKS.map(([href, label]) => {
        const current =
          href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={current ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
