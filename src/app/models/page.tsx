import type { Metadata } from "next";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import {
  formatUsd,
  MODEL_CATALOG,
  MODEL_TIER_LABELS,
  MODEL_TIERS,
  USAGE_MARKUP,
} from "@/lib/domain/pricing";

export const metadata: Metadata = {
  title: "Models — Lex Patent Studio",
  description:
    "Choose the reasoning engine per task. Published per-model rates, billed at provider cost × 1.50, with the estimate shown before every run.",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
};

export default function ModelsPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Models"
        title="Pick the engine per task. See the price before the run."
        lede="Fast for routine preparation, Advanced for drafting and analysis, Frontier for the hardest reasoning. Rates are effective-dated and published; usage is billed at provider cost × 1.50."
      />

      <section className="section" aria-label="Model rate table">
        {MODEL_TIERS.map((tier) => (
          <div key={tier} className="mb-10">
            <h2
              className="m-0 mb-3 text-[1.35rem] font-medium"
              style={{ fontFamily: "Georgia, serif" }}
            >
              {MODEL_TIER_LABELS[tier]}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[0.88rem]">
                <thead>
                  <tr className="border-b border-[var(--ink)] text-left">
                    <th className="py-2 pr-4 font-bold">Model</th>
                    <th className="py-2 pr-4 font-bold">Provider</th>
                    <th className="py-2 pr-4 text-right font-bold">
                      Provider rate in / 1M tokens
                    </th>
                    <th className="py-2 pr-4 text-right font-bold">
                      Provider rate out / 1M tokens
                    </th>
                    <th className="py-2 pr-4 text-right font-bold">
                      Billed in / 1M (×{USAGE_MARKUP.toFixed(2)})
                    </th>
                    <th className="py-2 pr-4 text-right font-bold">
                      Billed out / 1M (×{USAGE_MARKUP.toFixed(2)})
                    </th>
                    <th className="py-2 font-bold">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_CATALOG.filter((m) => m.tier === tier).map((m) => (
                    <tr key={m.id} className="border-b border-[var(--line)]">
                      <td className="py-2.5 pr-4">
                        <strong>{m.displayName}</strong>
                        {m.notes && (
                          <span className="block text-[0.72rem] text-[var(--muted)]">
                            {m.notes}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">{PROVIDER_LABELS[m.provider]}</td>
                      <td className="py-2.5 pr-4 text-right">
                        {formatUsd(m.inputPerMTokUsd)}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {formatUsd(m.outputPerMTokUsd)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-bold">
                        {formatUsd(m.inputPerMTokUsd * USAGE_MARKUP)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-bold">
                        {formatUsd(m.outputPerMTokUsd * USAGE_MARKUP)}
                      </td>
                      <td className="py-2.5 text-[0.8rem] text-[var(--muted)]">
                        {m.effectiveDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="max-w-[720px] space-y-3 text-[0.9rem] leading-relaxed">
          <p className="m-0">
            All usage is <strong>billed at provider cost × {USAGE_MARKUP.toFixed(2)}</strong>.
            Rates shown are local test-mode registry entries and are
            effective-dated; when a provider changes prices, a new entry takes
            effect and history is preserved.
          </p>
          <p className="m-0">
            Every run displays its estimated charge range and wallet
            sufficiency before execution. Second-model critique always uses a
            different model than the drafting model.
          </p>
        </div>
      </section>

      <Boundary>
        Model access runs exclusively through the server-side gateway with
        provider no-training configurations; no provider key ever reaches a
        browser. xAI/Grok models are listed for catalog completeness — their
        enablement for customer traffic is a separately approved decision.
      </Boundary>
    </MarketingShell>
  );
}
