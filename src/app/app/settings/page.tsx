import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { getEnv } from "@/lib/env";
import { can } from "@/lib/domain/roles";
import {
  MODEL_CATALOG,
  MODEL_TIER_LABELS,
  USAGE_MARKUP,
} from "@/lib/domain/pricing";

export const metadata: Metadata = {
  title: "Settings — Lex Patent Studio",
};

/**
 * /settings (§8.2): models, privacy/retention posture, integrations,
 * billing. Local mode is credential-free; every external integration below
 * is a documented seam with its exact enabling action, not a dead control.
 */
export default async function SettingsPage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const env = getEnv();
  const live = adapters.modelGateway.isLive();
  const mayManageBilling = can(session.role, "billing.manage");

  return (
    <div className="max-w-[1000px] space-y-8">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Settings
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          Model catalog, privacy and retention posture, and integration
          status for {session.organizationName}.
        </p>
      </header>

      <section aria-labelledby="models-heading">
        <h2 id="models-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Models
        </h2>
        <p className="max-w-[760px] text-[0.85rem] text-[var(--muted)]">
          All model calls go through the server-side gateway (no provider key
          ever reaches the browser). Charges are provider cost ×{" "}
          {USAGE_MARKUP.toFixed(2)} with effective-dated rates. Gateway status:{" "}
          <strong>{live ? "LIVE" : "not live — local mode, no provider reachable"}</strong>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.86rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                <th className="p-2">Model</th>
                <th className="p-2">Provider</th>
                <th className="p-2">Tier</th>
                <th className="p-2">Input $/MTok</th>
                <th className="p-2">Output $/MTok</th>
                <th className="p-2">Effective</th>
                <th className="p-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_CATALOG.map((model) => (
                <tr key={model.id} className="border-b border-[var(--line)]">
                  <td className="p-2 font-semibold">{model.displayName}</td>
                  <td className="p-2">{model.provider}</td>
                  <td className="p-2">{MODEL_TIER_LABELS[model.tier]}</td>
                  <td className="p-2">${model.inputPerMTokUsd.toFixed(2)}</td>
                  <td className="p-2">${model.outputPerMTokUsd.toFixed(2)}</td>
                  <td className="p-2 whitespace-nowrap">{model.effectiveDate}</td>
                  <td className="p-2 text-[0.78rem] text-[var(--muted)]">
                    {model.notes ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Privacy and retention posture
        </h2>
        <ul className="m-0 list-none space-y-2 p-0 text-[0.88rem]">
          {[
            "Customer content is never used to train models or improve the shared corpus; provider no-training configurations are mandatory (Invariant 19).",
            "Matter isolation is absolute: retrieval, prompts, caches, logs, and analytics never mix matters or tenants (Invariant 18).",
            "Provider calls use no-training/enterprise configurations, shortest feasible retention, and U.S. processing at launch (§13).",
            "Logs exclude prompt bodies, matter content, and conflict metadata (FR-10).",
            "Export-control screening halts automated processing on flagged technology categories pending qualified human review (§13).",
          ].map((item) => (
            <li key={item} className="border border-[var(--line)] bg-[var(--white)] p-3">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="integrations-heading">
        <h2 id="integrations-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Integrations (environment contract)
        </h2>
        <p className="max-w-[760px] text-[0.85rem] text-[var(--muted)]">
          Mode: <strong>{env.LEX_APP_MODE}</strong>. Production refuses to
          boot without every required credential; local mode requires none
          and reaches no external service.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.86rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                <th className="p-2">Integration</th>
                <th className="p-2">Status</th>
                <th className="p-2">Enabling action (Jeff)</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: "Supabase (private application project)",
                  envVars: "LEX_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY",
                  action: "Create project, apply supabase/migrations, set env vars (§17.1 approval)",
                },
                {
                  name: "Supabase (public corpus project — separate credentials)",
                  envVars: "LEX_CORPUS_SUPABASE_URL / ANON_KEY",
                  action: "Create corpus project, apply supabase/corpus-migrations, approve source registry (§20.9)",
                },
                {
                  name: "Stripe (subscriptions, wallet, portal)",
                  envVars: "LEX_STRIPE_SECRET_KEY / WEBHOOK_SECRET",
                  action: "Create Stripe account, approve pricing (§20.14) and live billing (§17.4)",
                },
                {
                  name: "OpenAI / Anthropic model gateway",
                  envVars: "LEX_OPENAI_API_KEY / LEX_ANTHROPIC_API_KEY",
                  action: "Provision keys with no-training terms; approve provider spend (§17.4)",
                },
                {
                  name: "xAI (Grok) for customer traffic",
                  envVars: "LEX_XAI_API_KEY",
                  action: "Separate explicit enablement (§20.13)",
                },
              ].map((row) => (
                <tr key={row.name} className="border-b border-[var(--line)] align-top">
                  <td className="p-2 font-semibold">{row.name}</td>
                  <td className="p-2">
                    <span className="border border-[#7d94ad] bg-[#e2ebf3] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#2c4763]">
                      Seam — not configured
                    </span>
                    <span className="mt-1 block text-[0.75rem] text-[var(--muted)]">
                      {row.envVars}
                    </span>
                  </td>
                  <td className="p-2 text-[0.82rem]">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="billing-heading">
        <h2 id="billing-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Billing
        </h2>
        <p className="m-0 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.88rem] leading-relaxed">
          {mayManageBilling
            ? "Your role can manage billing once Stripe is enabled."
            : "Billing management requires an owner or practitioner-admin role."}{" "}
          Plans (Explore $0 / Professional $149 / Team $499 / Enterprise
          custom) are test-mode defaults; final pricing, plan structure, and
          workflow fees require Jeff&apos;s explicit approval before anything goes
          live (PRD §20.14).
        </p>
      </section>
    </div>
  );
}
