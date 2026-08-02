"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<[string, string]> = [
  ["/wepatent/app", "Dashboard"],
  ["/wepatent/app/inventions/new", "New invention"],
  ["/wepatent/app/counsel", "Counsel requests"],
  ["/wepatent/app/billing", "Billing"],
  ["/wepatent/app/settings", "Settings"],
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="wp-nav" aria-label="Application">
      {LINKS.map(([href, label]) => {
        const current =
          href === "/wepatent/app" ? pathname === "/wepatent/app" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={current ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
