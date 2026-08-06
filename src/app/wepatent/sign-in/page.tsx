import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";
import { isLocalMode } from "@/lib/wepatent/env";
import { signInAction } from "./actions";

export const metadata: Metadata = {
  title: "Sign in | wepatent",
  description: "Sign in to your wepatent workspace.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; status?: string }>;
}) {
  const { error, next, status } = await searchParams;
  return (
    <PublicShell>
      <div className="policy-page signin-page">
        <p className="venture-kicker">Authentication</p>
        <h1>Sign in to wepatent.</h1>
        {status === "password_updated" && (
          <div className="terms-warning" role="status">
            Your password was updated. Sign in with the new password.
          </div>
        )}
        {isLocalMode && (
          <div className="terms-warning" role="note">
            <strong>Local preview mode.</strong> This build runs without external accounts. Enter any
            email to create a synthetic workspace — data is in-memory, synthetic only, and resets when
            the server restarts. Production sign-in uses verified email authentication.
          </div>
        )}
        <form action={signInAction} className="signin-form">
          {error === "invalid_email" && (
            <p className="form-error" role="alert" id="email-error">
              Enter a valid email address.
            </p>
          )}
          {error === "rate_limited" && (
            <p className="form-error" role="alert">
              Too many sign-in attempts. Please wait a few minutes and try again.
            </p>
          )}
          {error === "invalid_credentials" && (
            <p className="form-error" role="alert">
              The email or password was not accepted. Verify both and try again.
            </p>
          )}
          {error === "verification_failed" && (
            <p className="form-error" role="alert">
              That verification link is invalid or expired. Request a new link and try again.
            </p>
          )}
          {error === "mfa_required" && (
            <p className="form-error" role="alert">
              Counsel administrator access requires multi-factor authentication enrollment.
            </p>
          )}
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-describedby={error === "invalid_email" ? "email-error" : undefined}
            />
          </div>
          {isLocalMode ? (
            <div className="field">
              <label htmlFor="name">Display name (optional)</label>
              <input id="name" name="name" type="text" autoComplete="name" maxLength={120} />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={512}
                required
              />
            </div>
          )}
          <input type="hidden" name="next" value={next ?? ""} />
          <button className="button venture-button" type="submit">
            Continue
          </button>
        </form>
        {!isLocalMode && (
          <p className="consent-legal">
            New here? <Link href="/wepatent/sign-up">Create an account</Link>. Forgot your
            password? <Link href="/wepatent/recover">Reset it securely</Link>.
          </p>
        )}
        <p className="consent-legal">
          Signing in does not make you a client of any law firm and does not create an
          attorney-client relationship. See the <Link href="/wepatent/terms">Self-Service Terms</Link>.
        </p>
      </div>
    </PublicShell>
  );
}
