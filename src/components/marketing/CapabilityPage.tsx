import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "./Shell";

/**
 * Shared layout for §8.1 capability/audience pages, in the DESIGN-HANDOFF
 * posture (typography-led rows, no fake metrics, boundary statement on
 * every page). Content rules (PRD §1) apply to every caller.
 */
export interface CapabilityRow {
  title: string;
  text: string;
}

export function CapabilityPage({
  kicker,
  title,
  lede,
  rows,
  boundary,
  next,
}: {
  kicker: string;
  title: string;
  lede: string;
  rows: CapabilityRow[];
  boundary: string;
  next?: { href: string; label: string };
}) {
  return (
    <MarketingShell>
      <PageIntro kicker={kicker} title={title} lede={lede} />
      <section className="section" aria-label="Details">
        <div className="workflow-list">
          {rows.map((row, index) => (
            <article className="workflow-row" key={row.title}>
              <span className="row-index">0{index + 1}</span>
              <div>
                <h3>{row.title}</h3>
              </div>
              <p>{row.text}</p>
            </article>
          ))}
        </div>
        {next && (
          <p className="mt-8 text-[0.9rem]">
            <Link href={next.href} className="text-link">
              {next.label} →
            </Link>
          </p>
        )}
      </section>
      <Boundary>{boundary}</Boundary>
    </MarketingShell>
  );
}
