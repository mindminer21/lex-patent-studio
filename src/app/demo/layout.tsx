import Link from "next/link";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex min-h-[60px] flex-wrap items-center gap-4 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-2 sm:px-6">
        <Link href="/" className="wordmark">
          <span className="wordmark-mark">L</span> Lex Patent Studio
        </Link>
        <strong className="border border-[#7d94ad] bg-[#e2ebf3] px-2 py-1 text-[0.7rem] uppercase tracking-[0.08em] text-[#2c4763]">
          Anonymous read-only demo · synthetic data
        </strong>
        <Link className="ml-auto text-sm font-semibold underline" href="/login">
          Invited-user sign in
        </Link>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-[var(--line)] px-4 py-4 text-center text-xs text-[var(--muted)]">
        No demo control writes data or calls a model. All names, matters, facts, sources, and
        work product are fictitious.
      </footer>
    </div>
  );
}
