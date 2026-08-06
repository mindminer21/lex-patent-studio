import Link from "next/link";
import { notFound } from "next/navigation";
import {
  SEED_DOCUMENTS,
  SEED_FACTS,
  SEED_MATTERS,
  SEED_SOURCES,
} from "@/lib/adapters/local/seed";
import { DraftWatermark, TierBadge, VerificationBadge } from "@/components/workspace/badges";

export default async function DemoMatterPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const matter = SEED_MATTERS.find((item) => item.id === matterId);
  if (!matter) notFound();
  const facts = SEED_FACTS.filter((item) => item.matterId === matterId);
  const sources = SEED_SOURCES.filter((item) => item.matterId === matterId);
  const documents = SEED_DOCUMENTS.filter((item) => item.matterId === matterId);
  return (
    <div className="space-y-9">
      <header>
        <Link className="text-sm font-semibold underline" href="/demo">← Demo matters</Link>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{matter.matterNumber}</p>
        <h1 className="mt-2 font-serif text-4xl">{matter.title}</h1>
        <p className="text-[var(--muted)]">{matter.technologyArea} · {matter.jurisdiction} · synthetic</p>
      </header>
      <section>
        <h2 className="font-serif text-2xl">Fact record</h2>
        <ul className="list-none space-y-2 p-0">
          {facts.map((fact) => (
            <li key={fact.id} className="border border-[var(--line)] bg-white p-4">
              <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{fact.category} · {fact.provenance.replaceAll("_", " ")}</p>
              <p className="mb-0 mt-2 text-sm leading-relaxed">{fact.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-serif text-2xl">Sources</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {sources.map((source) => <li key={source.id}>{source.title} · {source.extractionState.replaceAll("_", " ")}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="font-serif text-2xl">Draft work product</h2>
        <div className="space-y-3">
          {documents.map((document) => (
            <article key={document.id} className="border border-[var(--line)] bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <TierBadge tier={document.tier} compact />
                <DraftWatermark reviewState={document.reviewState} />
                <VerificationBadge state={document.verificationState} />
                <strong>{document.title}</strong>
              </div>
              <p className="mb-0 mt-3 text-sm text-[var(--muted)]">Version {document.version} · review metadata only in this anonymous demo.</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
