import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import AppNav from "@/components/wepatent/AppNav";
import { isLocalMode } from "@/lib/wepatent/env";
import { requireUser } from "@/lib/server/session";
import { signOutAction } from "@/app/wepatent/sign-in/actions";

export const metadata: Metadata = {
  title: "Workspace | wepatent",
  description: "wepatent invention-record workspace.",
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requireUser();
  return (
    <div className="wp-app">
      <aside className="wp-sidebar">
        <Link className="venture-wordmark" href="/wepatent/app" aria-label="wepatent workspace home">
          <span>wp</span> wepatent
        </Link>
        <AppNav />
        <div className="wp-sidebar-footer">
          <p>
            Signed in as <strong>{context.user.displayName}</strong>
            {context.organization ? <> · {context.organization.name}</> : null}
          </p>
          {isLocalMode && (
            <p>
              <strong>Local preview:</strong> in-memory synthetic data only. No external accounts,
              no real billing, no real model calls.
            </p>
          )}
          <p>
            wepatent is not a law firm and does not provide legal advice. Generated documents are
            working drafts that require review and approval by qualified patent counsel.
          </p>
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
          <span>wepatent — self-service invention documentation</span>
          <span>Not a law firm · Not legal advice · Working drafts require counsel review</span>
        </footer>
      </div>
    </div>
  );
}
