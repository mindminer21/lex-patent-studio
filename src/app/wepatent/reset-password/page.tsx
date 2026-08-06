import type { Metadata } from "next";
import PublicShell from "@/components/wepatent/PublicShell";
import { resetPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Choose a new password | Invention workspace" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <PublicShell>
      <div className="policy-page signin-page">
        <p className="venture-kicker">Account recovery</p>
        <h1>Choose a new password.</h1>
        {error && (
          <p className="form-error" role="alert">
            {error === "mismatch"
              ? "The passwords do not match."
              : "Use a password of at least 12 characters and try again."}
          </p>
        )}
        <form action={resetPasswordAction} className="signin-form">
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={512}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmation">Confirm new password</label>
            <input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={512}
              required
            />
          </div>
          <button className="button venture-button" type="submit">
            Update password
          </button>
        </form>
      </div>
    </PublicShell>
  );
}
