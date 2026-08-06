import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";
import { recoverAction } from "./actions";

export const metadata: Metadata = { title: "Reset password | Invention workspace" };

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return (
    <PublicShell>
      <div className="policy-page signin-page">
        <p className="venture-kicker">Account recovery</p>
        <h1>Reset your password.</h1>
        {status === "check_email" && (
          <div className="terms-warning" role="status">
            If that address has an account, a recovery link is on its way.
          </div>
        )}
        <form action={recoverAction} className="signin-form">
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <button className="button venture-button" type="submit">
            Send recovery link
          </button>
        </form>
        <p className="consent-legal">
          <Link href="/wepatent/sign-in">Return to sign in</Link>
        </p>
      </div>
    </PublicShell>
  );
}
