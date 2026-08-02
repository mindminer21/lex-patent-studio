import { getAdapters } from "@/lib/adapters";
import { ProvenanceBadge } from "@/components/workspace/badges";
import { can } from "@/lib/domain/roles";
import { canTransitionFact } from "@/lib/domain/provenance";
import { AddFactForm, ApproveFactButton } from "./FactForms";

/**
 * §8.2 /facts — canonical fact ledger with provenance states, approval
 * flow (fact_events), and contributor attribution. Approval rights are
 * enforced server-side; the button is also hidden for roles without them.
 */
export default async function FactsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const [facts, events, sources] = await Promise.all([
    adapters.data.listFacts(org, matterId),
    adapters.data.listFactEvents(org, matterId),
    adapters.data.listSources(org, matterId),
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const approved = facts.filter((f) => f.provenance === "counsel_reviewed").length;
  const canApprove = can(session.role, "facts.approve");
  const canContribute = can(session.role, "facts.contribute");

  return (
    <div className="grid max-w-[1200px] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="Fact ledger">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
            Fact ledger
          </h2>
          <span className="text-[0.8rem] text-[var(--muted)]">
            {approved}/{facts.length} counsel-reviewed · drafting draws on
            approved facts only
          </span>
        </div>

        {facts.length === 0 ? (
          <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
            No facts yet. Drafting is blocked until a practitioner approves a
            fact baseline.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-3 p-0">
            {facts.map((fact) => (
              <li key={fact.id} className="border border-[var(--line)] bg-[var(--white)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.66rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    {fact.category}
                  </span>
                  <ProvenanceBadge state={fact.provenance} />
                  <span className="ml-auto text-[0.7rem] text-[var(--muted)]">
                    v{fact.version} · {fact.contributedBy}
                  </span>
                </div>
                <p className="mb-0 mt-2 text-[0.88rem] leading-relaxed">{fact.text}</p>
                {fact.sourceIds.length > 0 && (
                  <p className="mb-0 mt-1.5 text-[0.72rem] text-[var(--muted)]">
                    Sources:{" "}
                    {fact.sourceIds
                      .map((id) => sourceById.get(id)?.title ?? id)
                      .join(" · ")}
                  </p>
                )}
                {canApprove &&
                  canTransitionFact(fact.provenance, "counsel_reviewed", "human") && (
                    <div className="mt-2">
                      <ApproveFactButton matterId={matterId} factId={fact.id} />
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}

        {canContribute && (
          <div className="mt-5">
            <AddFactForm matterId={matterId} />
          </div>
        )}
      </section>

      <aside aria-label="Fact events" className="min-w-0">
        <h2 className="m-0 mb-3 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[var(--muted)]">
          Fact events (immutable)
        </h2>
        {events.length === 0 ? (
          <p className="m-0 border border-dashed border-[var(--line)] bg-[var(--white)] p-3 text-[0.8rem] text-[var(--muted)]">
            No fact events recorded in this session yet. Contributions and
            approvals append here with actor, role, and provenance transition.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {events.map((event) => (
              <li
                key={event.id}
                className="border border-[var(--line)] bg-[var(--white)] p-2.5 text-[0.75rem] leading-snug"
              >
                <strong>{event.eventType}</strong>{" "}
                {event.fromProvenance && event.toProvenance
                  ? `· ${event.fromProvenance} → ${event.toProvenance}`
                  : event.toProvenance
                    ? `· ${event.toProvenance}`
                    : ""}
                <span className="block text-[var(--muted)]">
                  {event.factId} · {event.actorUserId} ({event.actorRole}) ·{" "}
                  {event.createdAt.slice(0, 16).replace("T", " ")}Z
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[0.7rem] leading-relaxed text-[var(--muted)]">
          Counsel review is a human practitioner action. Model and system
          actors can propose source-supported or needs-confirmation states,
          never counsel review.
        </p>
      </aside>
    </div>
  );
}
