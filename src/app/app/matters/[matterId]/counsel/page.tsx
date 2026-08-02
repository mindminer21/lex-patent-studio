import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Counsel — Lex Patent Studio",
};

/**
 * Connected-counsel status (§8.2 /counsel, §9.7). The professional lane can
 * route overflow/conflicted-out/filing work through the SAME gated state
 * machine as the shared platform (PRD-wepatent §7.6) — no shortcut skips
 * conflict intake or engagement gates.
 *
 * Connected-counsel intake is an approval-gated capability (PRD-wepatent
 * §17.7 and entity-structure open item §21.2): it is NOT enabled in this
 * environment, and this surface says so instead of presenting dead controls.
 */
const STATE_MACHINE = [
  { state: "draft", note: "Request prepared inside the tenant; nothing disclosed." },
  { state: "submitted", note: "Conspicuous status: NOT YET REPRESENTED." },
  { state: "conflict_review", note: "Limited conflict intake only — no substantive disclosure." },
  { state: "declined / consultation_offered", note: "Attorney decision is explicit; silence is never acceptance." },
  { state: "consultation_scheduled", note: "Consultation is not engagement." },
  { state: "engagement_offered", note: "Separate engagement terms, scope, and fees." },
  { state: "engagement_signed", note: "Representation begins ONLY here." },
  { state: "converted_to_matter", note: "Full matter transfer under the signed engagement." },
] as const;

export default async function MatterCounselPage() {
  return (
    <div className="max-w-[860px] space-y-5">
      <section aria-labelledby="counsel-heading">
        <h2 id="counsel-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Connected counsel
        </h2>
        <p className="mt-1 text-[0.9rem] text-[var(--muted)]">
          Route overflow, conflicted-out, or filing work to connected patent
          counsel through the shared, gated pathway. A request, upload,
          scheduling action, or payment is <strong>not</strong> an engagement
          — representation requires conflict review, attorney acceptance, and
          a signed engagement agreement.
        </p>
      </section>

      <p className="m-0 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem]">
        <strong>Status:</strong> no counsel request exists for this matter.
        <span className="mt-1 block text-[0.85rem] text-[var(--muted)]">
          Connected-counsel intake is approval-gated platform capability
          (PRD-wepatent §17.7; entity-structure decision §21.2) and is not
          enabled in this environment. When enabled, requests start below at
          “draft” and every gate is enforced server-side — no professional-lane
          shortcut skips conflict intake or engagement.
        </span>
      </p>

      <section aria-labelledby="csm-heading">
        <h3 id="csm-heading" className="m-0 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          The gated state machine (shared platform contract)
        </h3>
        <ol className="mb-0 mt-2 list-none space-y-1.5 p-0">
          {STATE_MACHINE.map((step, i) => (
            <li key={step.state} className="flex gap-3 border border-[var(--line)] bg-[var(--white)] p-2.5 text-[0.85rem]">
              <span className="w-6 shrink-0 text-right font-bold text-[var(--muted)]">{i + 1}</span>
              <span>
                <strong>{step.state}</strong>
                <span className="block text-[var(--muted)]">{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="m-0 border border-[#b9a76a] bg-[#f4ecd2] p-3 text-[0.82rem] font-semibold text-[#5d4a12]">
        Lex Patent Studio never files, signs, or communicates with the USPTO
        or an end client on anyone&apos;s behalf. Counsel filing runs under the
        separately gated counsel context with its own roles and audit policy.
      </p>
    </div>
  );
}
