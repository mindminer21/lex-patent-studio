import type { Metadata } from "next";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import { lexResetPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Choose a new password — Lex Patent Studio" };

export default async function LexResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <MarketingShell>
      <PageIntro kicker="Account recovery" title="Choose a new password." lede="The recovery session is verified server-side and is invalidated after the password changes." />
      <section className="section">
        <div className="max-w-[640px] border border-[var(--line)] bg-[var(--white)] p-6">
          {error && <p className="border border-[#a64b3c] bg-[#fff1ef] p-3 text-sm" role="alert">{error === "mismatch" ? "The passwords do not match." : "Use a password of at least 12 characters."}</p>}
          <form action={lexResetPasswordAction} className="space-y-4">
            <label className="block text-sm font-semibold" htmlFor="new-password">New password</label>
            <input className="w-full border border-[var(--line)] p-3" id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={512} required />
            <label className="block text-sm font-semibold" htmlFor="confirm-password">Confirm new password</label>
            <input className="w-full border border-[var(--line)] p-3" id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={512} required />
            <button className="button" type="submit">Update password</button>
          </form>
        </div>
      </section>
      <Boundary>Changing credentials does not change tenant membership, role, or practitioner supervision duties.</Boundary>
    </MarketingShell>
  );
}
