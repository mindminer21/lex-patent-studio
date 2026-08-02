import Link from "next/link";
import { getAdapters } from "@/lib/adapters";
import {
  DraftWatermark,
  ReviewBadge,
  TierBadge,
  VerificationBadge,
} from "@/components/workspace/badges";
import { TIER_META } from "@/lib/domain/tiers";
import { DecisionForm } from "./DecisionForm";

export default async function ReviewQueuePage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const [items, matters, audit] = await Promise.all([
    adapters.data.listReviewItems(org),
    adapters.data.listMatters(org),
    adapters.data.listAuditEvents(org, { limit: 8 }),
  ]);
  const matterById = new Map(matters.map((m) => [m.id, m]));
  const open = items.filter((i) => i.state === "pending_review");
  const decided = items.filter((i) => i.state !== "pending_review");
  const decisionEvents = audit.filter((e) => e.action.startsWith("review."));

  return (
    <div className="max-w-[1000px]">
      <h1 className="text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        Review queue
      </h1>
      <p className="mt-1 text-[0.9rem] text-[var(--muted)]">
        Pending Tier-B and Tier-C items across your matters,
        oldest-deadline-first, plus Tier-A operator items. Only an
        authenticated human with the required role can record a decision —
        model output never sets review state.
      </p>

      {open.length === 0 ? (
        <p className="mt-6 border border-dashed border-[var(--line)] bg-[var(--white)] p-5 text-[0.9rem] text-[var(--muted)]">
          The queue is empty. New workflow output enters here as{" "}
          <strong>DRAFT — NOT REVIEWED</strong> with its work-tier label and
          stays a draft until a qualified human approves it.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {open.map((item) => (
            <article key={item.id} className="border border-[var(--line)] bg-[var(--white)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <TierBadge tier={item.tier} />
                <DraftWatermark reviewState={item.state} />
                <VerificationBadge state={item.verificationState} />
                <span className="ml-auto text-[0.78rem] text-[var(--muted)]">
                  due {item.dueDate ?? "—"}
                </span>
              </div>

              <h2 className="mb-0 mt-2 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
                {item.documentTitle}
              </h2>
              <p className="mb-0 mt-0.5 text-[0.8rem] text-[var(--muted)]">
                <Link
                  href={`/app/matters/${item.matterId}`}
                  className="font-bold underline underline-offset-4"
                >
                  {matterById.get(item.matterId)?.matterNumber}
                </Link>{" "}
                · doc hash {item.documentVersionHash} · required action:{" "}
                {TIER_META[item.tier].requiredHumanAction}
              </p>

              {item.criticReportSummary && (
                <p className="mb-0 mt-3 border border-[var(--line)] bg-[var(--paper)] p-2.5 text-[0.82rem] leading-relaxed">
                  <strong>Critic report:</strong> {item.criticReportSummary}
                </p>
              )}

              {item.deterministicCheckFailures > 0 && (
                <p className="mb-0 mt-2 border-l-4 border-[#a05252] bg-[#f6dcdc] px-2 py-1.5 text-[0.8rem] text-[#7c1f1f]">
                  {item.deterministicCheckFailures} deterministic check failure
                  {item.deterministicCheckFailures === 1 ? "" : "s"} — cannot be
                  dismissed silently; dismissal requires a recorded reason.
                </p>
              )}

              {item.unresolvedFlags.map((flag) => (
                <p
                  key={flag}
                  className="mb-0 mt-2 border-l-4 border-[#b9a76a] bg-[#f4ecd2] px-2 py-1.5 text-[0.8rem] text-[#5d4a12]"
                >
                  {flag}
                </p>
              ))}

              <DecisionForm reviewItemId={item.id} />
            </article>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <section className="mt-8" aria-label="Recently decided">
          <h2 className="text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
            Recently decided
          </h2>
          <ul className="list-none space-y-2 p-0">
            {decided.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 border border-[var(--line)] bg-[var(--white)] p-2.5 text-[0.85rem]">
                <TierBadge tier={item.tier} compact />
                <ReviewBadge state={item.state} />
                <span className="min-w-[200px] flex-1">{item.documentTitle}</span>
                <span className="text-[0.75rem] text-[var(--muted)]">
                  hash {item.documentVersionHash}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-label="Decision audit log">
        <h2 className="text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Decision audit log
        </h2>
        {decisionEvents.length === 0 ? (
          <p className="text-[0.85rem] text-[var(--muted)]">
            No review decisions recorded yet. Every decision is stored with
            actor, role, timestamp, and document-version hash.
          </p>
        ) : (
          <ul className="list-none space-y-2 p-0">
            {decisionEvents.map((event) => (
              <li key={event.id} className="border-l-4 border-[var(--forest)] bg-[var(--white)] px-3 py-2 text-[0.8rem] leading-snug">
                <strong>{event.action}</strong> by {event.actorUserId} (
                {event.actorRole}) ·{" "}
                {new Date(event.createdAt).toISOString().slice(0, 19).replace("T", " ")}Z
                <span className="block text-[var(--muted)]">{event.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
