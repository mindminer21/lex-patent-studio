import { Boundary, MarketingShell, PageIntro } from "./Shell";

/**
 * Legal document stub (PRD §8.1 /legal/*). Real documents require final
 * legal review before public launch (PRD §2.8); these stubs state the
 * committed positions the drafts must carry.
 */
export function LegalStub({
  kicker,
  title,
  lede,
  positions,
}: {
  kicker: string;
  title: string;
  lede: string;
  positions: string[];
}) {
  return (
    <MarketingShell>
      <PageIntro kicker={kicker} title={title} lede={lede} />
      <section className="section" aria-label="Committed positions">
        <p className="m-0 mb-5 inline-block border border-[#b9a76a] bg-[#f4ecd2] px-2 py-1 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#5d4a12]">
          Draft stub — requires final legal review before launch
        </p>
        <h2 className="m-0 mb-3 text-[1.2rem] font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Positions this document will carry
        </h2>
        <ul className="m-0 max-w-[760px] list-disc space-y-2.5 pl-5 text-[0.92rem] leading-relaxed">
          {positions.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
      <Boundary>
        This stub is a product artifact, not a binding document. The final
        text is prepared and approved by counsel before any public launch or
        live billing.
      </Boundary>
    </MarketingShell>
  );
}
