import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";
import { signUpAction } from "./actions";

export const metadata: Metadata = {
  title: "Create account | Invention workspace",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { error, status } = await searchParams;
  return (
    <PublicShell>
      <div className="policy-page signin-page">
        <p className="venture-kicker">Create account</p>
        <h1>Start a private invention workspace.</h1>
        {status === "check_email" ? (
          <div className="terms-warning" role="status">
            <strong>Check your email.</strong> Use the verification link to activate your
            account. The same neutral response is shown whether an address is new or already
            registered.
          </div>
        ) : (
          <form action={signUpAction} className="signin-form">
            {error && (
              <p className="form-error" role="alert">
                We could not start account verification. Check the fields and try again.
              </p>
            )}
            <div className="field">
              <label htmlFor="displayName">Your name</label>
              <input id="displayName" name="displayName" autoComplete="name" maxLength={120} required />
            </div>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={512}
                required
              />
              <p className="field-help">Use at least 12 characters.</p>
            </div>
            <button className="button venture-button" type="submit">
              Verify my email
            </button>
          </form>
        )}
        <p className="consent-legal">
          Already registered? <Link href="/wepatent/sign-in">Sign in</Link>. Account creation
          does not create an attorney-client relationship.
        </p>
      </div>
    </PublicShell>
  );
}
