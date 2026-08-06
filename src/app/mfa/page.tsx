import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import { getEnv } from "@/lib/env";
import { getPool } from "@/lib/adapters/production/db";
import {
  createLexAuthServices,
  getLexActiveProviderSession,
} from "@/lib/adapters/production/lex-auth-session";
import { LexEnrollmentForm } from "./LexEnrollmentForm";
import { verifyLexMfaAction } from "./actions";

export const metadata: Metadata = { title: "Verify authenticator — Lex Patent Studio" };

function safeNext(value: string | undefined): string {
  return value === "/app" || value?.startsWith("/app/") ? value : "/app";
}

export default async function LexMfaPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  const env = getEnv();
  if (env.LEX_APP_MODE !== "production") redirect("/app");
  const pool = getPool(env.LEX_DATABASE_URL!);
  const session = await getLexActiveProviderSession(pool);
  if (!session) redirect("/login?error=invalid_credentials");
  const status = await createLexAuthServices(pool).mfaAuth.status({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  if (!status.ok) redirect("/login?error=invalid_credentials");
  if (status.currentLevel === "aal2") redirect(next);
  return (
    <MarketingShell>
      <PageIntro kicker="Secure access" title="Verify your authenticator." lede="Lex requires MFA for tenant administrators, connected counsel, and platform support." />
      <section className="section">
        <div className="max-w-[640px] border border-[var(--line)] bg-[var(--white)] p-6">
          {error && <p className="border border-[#a64b3c] bg-[#fff1ef] p-3 text-sm" role="alert">That code was not accepted. Enter the current six-digit code.</p>}
          {status.verifiedFactorId ? (
            <form action={verifyLexMfaAction} className="space-y-4">
              <input type="hidden" name="factorId" value={status.verifiedFactorId} />
              <input type="hidden" name="next" value={next} />
              <label className="block text-sm font-semibold" htmlFor="lex-code">Six-digit code</label>
              <input className="w-full border border-[var(--line)] p-3" id="lex-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required autoFocus />
              <button className="button" type="submit">Verify and continue</button>
            </form>
          ) : <LexEnrollmentForm next={next} />}
        </div>
      </section>
      <Boundary>Authentication establishes software access only. Every Lex output remains a draft under practitioner supervision.</Boundary>
    </MarketingShell>
  );
}
