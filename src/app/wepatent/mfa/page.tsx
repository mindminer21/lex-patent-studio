import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PublicShell from "@/components/wepatent/PublicShell";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { getAuthenticatedProviderSession } from "@/lib/server/session";
import { EnrollmentForm } from "./EnrollmentForm";
import { verifyMfaAction } from "./actions";

export const metadata: Metadata = { title: "Verify authenticator | Secure access" };

function safeNext(value: string | undefined): string {
  if (value === "/counsel" || value?.startsWith("/counsel/")) return value;
  if (value === "/wepatent/app" || value?.startsWith("/wepatent/app/")) return value;
  return "/wepatent/app";
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  const session = await getAuthenticatedProviderSession();
  if (!session) redirect("/wepatent/sign-in?error=verification_failed");
  const status = await createConsumerAuthServices().mfaAuth.status({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  if (!status.ok) redirect("/wepatent/sign-in?error=verification_failed");
  if (status.currentLevel === "aal2") redirect(next);

  return (
    <PublicShell>
      <div className="policy-page signin-page">
        <p className="venture-kicker">Secure access</p>
        <h1>Verify your authenticator.</h1>
        {error && (
          <p className="form-error" role="alert">
            That code was not accepted. Enter the current six-digit code and try again.
          </p>
        )}
        {status.verifiedFactorId ? (
          <form action={verifyMfaAction} className="signin-form">
            <input type="hidden" name="factorId" value={status.verifiedFactorId} />
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="code">Six-digit code</label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                autoFocus
              />
            </div>
            <button className="button venture-button" type="submit">
              Verify and continue
            </button>
          </form>
        ) : (
          <EnrollmentForm next={next} />
        )}
      </div>
    </PublicShell>
  );
}
