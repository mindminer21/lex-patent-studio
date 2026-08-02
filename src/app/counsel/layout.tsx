import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { isLocalMode } from "@/lib/env";
import { requireCounsel } from "@/lib/server/session";
import { signOutAction } from "@/app/wepatent/sign-in/actions";

export const metadata: Metadata = {
  title: "Counsel administration | wepatent",
  description: "Connected-counsel administration lane.",
};

/**
 * Connected-counsel administration lane (PRD §6.3): separate roles,
 * separate navigation, separate audit policy. Ordinary organization
 * sessions are redirected away by requireCounsel().
 */
export default async function CounselLayout({ children }: { children: ReactNode }) {
  const context = await requireCounsel();
  return (
    <div className="wp-app">
      <aside className="wp-sidebar">
        <Link className="venture-wordmark" href="/counsel" aria-label="Counsel administration home">
          <span>wp</span> counsel lane
        </Link>
        <nav className="wp-nav" aria-label="Counsel administration">
          <Link href="/counsel/requests">Requests</Link>
        </nav>
        <div className="wp-sidebar-footer">
          <p>
            Signed in as <strong>{context.user.displayName}</strong> ·{" "}
            <span className="wp-badge neutral">{context.assignment.role}</span>
          </p>
          <p>{context.assignment.lawFirmName}</p>
          <p>
            Every action in this lane is recorded in the counsel audit trail. Legal-service fees,
            trust funds, and law-firm records stay entirely outside wepatent billing.
          </p>
          {isLocalMode && (
            <p>
              <strong>Local preview:</strong> synthetic data only. Enabling connected-counsel
              intake in production is approval-gated (PRD §17.7).
            </p>
          )}
          <form action={signOutAction}>
            <button className="button button-secondary button-small" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div>
        <main className="wp-main">{children}</main>
        <footer className="wp-app-footer">
          <span>Connected-counsel administration</span>
          <span>
            Representation is defined by a signed engagement letter with the law firm — never by
            wepatent
          </span>
        </footer>
      </div>
    </div>
  );
}
