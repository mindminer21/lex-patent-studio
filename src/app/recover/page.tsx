import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import { lexRecoverAction } from "./actions";

export const metadata: Metadata = { title: "Reset password — Lex Patent Studio" };

export default async function LexRecoverPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return (
    <MarketingShell>
      <PageIntro kicker="Account recovery" title="Reset your password." lede="Recovery is available only to invited Lex accounts." />
      <section className="section">
        <div className="max-w-[640px] border border-[var(--line)] bg-[var(--white)] p-6">
          {status === "check_email" && <p className="border border-[#b9a76a] bg-[#f4ecd2] p-3 text-sm" role="status">If that address has an invited account, a recovery link is on its way.</p>}
          <form action={lexRecoverAction} className="space-y-4">
            <label className="block text-sm font-semibold" htmlFor="recover-email">Email address</label>
            <input className="w-full border border-[var(--line)] p-3" id="recover-email" name="email" type="email" autoComplete="email" required />
            <button className="button" type="submit">Send recovery link</button>
          </form>
          <p className="mb-0 mt-4 text-sm"><Link href="/login">Return to sign in</Link></p>
        </div>
      </section>
      <Boundary>Recovery does not create access for an uninvited address or change tenant membership.</Boundary>
    </MarketingShell>
  );
}
