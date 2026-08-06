import Link from "next/link";
import { SEED_MATTERS, SEED_REVIEW_ITEMS, SEED_RUNS } from "@/lib/adapters/local/seed";
import { TierBadge, DraftWatermark } from "@/components/workspace/badges";

export default function DemoPage() {
  const pending = SEED_REVIEW_ITEMS.filter((item) => item.state === "pending_review");
  return (
    <div className="space-y-10">
      <header>
        <p className="kicker">Practitioner beta preview</p>
        <h1 className="font-serif text-4xl">A reviewable patent-work record, not an autonomous lawyer.</h1>
        <p className="mt-3 max-w-[820px] text-[var(--muted)]">
          Explore a fixed synthetic tenant. This demo has no account, upload, generation,
          approval, export, billing, or filing capability.
        </p>
      </header>
      <section aria-labelledby="demo-matters">
        <h2 id="demo-matters" className="font-serif text-2xl">Synthetic matters</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {SEED_MATTERS.map((matter) => (
            <article key={matter.id} className="border border-[var(--line)] bg-white p-5">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{matter.matterNumber}</p>
              <h3 className="mt-2 font-serif text-xl">{matter.title}</h3>
              <p className="text-sm text-[var(--muted)]">{matter.technologyArea} · {matter.jurisdiction}</p>
              <Link className="font-semibold underline" href={`/demo/matters/${matter.id}`}>
                Inspect the read-only matter →
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="demo-review">
        <h2 id="demo-review" className="font-serif text-2xl">Review queue</h2>
        <ul className="list-none space-y-2 p-0">
          {pending.slice(0, 4).map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 border border-[var(--line)] bg-white p-4">
              <TierBadge tier={item.tier} compact />
              <DraftWatermark reviewState={item.state} />
              <strong className="min-w-[240px] flex-1">{item.documentTitle}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="demo-runs">
        <h2 id="demo-runs" className="font-serif text-2xl">Workflow evidence</h2>
        <p className="text-sm text-[var(--muted)]">
          The demo records {SEED_RUNS.length} synthetic runs with model, tier, source, state,
          estimate, and review metadata. No run can be started from this surface.
        </p>
      </section>
    </div>
  );
}
