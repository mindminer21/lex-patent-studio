import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import {
  DraftWatermark,
  ReviewBadge,
  TierBadge,
  VerificationBadge,
} from "@/components/workspace/badges";
import { TIER_META } from "@/lib/domain/tiers";
import { DecisionForm } from "@/app/app/review-queue/DecisionForm";

export const metadata: Metadata = {
  title: "Reviews — Lex Patent Studio",
};

/**
 * Matter-scoped tier queue (§8.2 /reviews, §9.6): critic reports,
 * verification state, deterministic-check results, and human approvals.
 * Only authenticated humans with the required role can decide (Inv. 16).
 */
export default async function MatterReviewsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const items = await adapters.data.listReviewItems(session.organizationId, {
    matterId,
  });
  const open = items.filter((i) => i.state === "pending_review");
  const decided = items.filter((i) => i.state !== "pending_review");
  const decisions = await adapters.data.listAuditEvents(session.organizationId, {
    matterId,
  });
  const decisionEvents = decisions.filter((e) => e.action.startsWith("review."));

  return (
    <div className="max-w-[1000px] space-y-6">
      <section aria-labelledby="mrev-heading">
        <h2 id="mrev-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Review queue for this matter
        </h2>
        <p className="mt-1 max-w-[760px] text-[0.85rem] text-[var(--muted)]">
          Each item shows the critic report, verification state, and
          deterministic-check results. Decisions record actor, role,
          timestamp, and document-version hash; approval unlocks
          watermark-free export.
        </p>
      </section>

      {open.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
          Nothing pending in this matter. New workflow output enters here as{" "}
          <strong>DRAFT — NOT REVIEWED</strong> with its tier label.
        </p>
      ) : (
        <div className="space-y-5">
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
              <h3 className="mb-0 mt-2 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
                {item.documentTitle}
              </h3>
              <p className="mb-0 mt-0.5 text-[0.8rem] text-[var(--muted)]">
                doc hash {item.documentVersionHash} · required action:{" "}
                {TIER_META[item.tier].requiredHumanAction}
                {item.criticModelId ? ` · critic model ${item.criticModelId}` : ""}
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
        <section aria-label="Decided items in this matter">
          <h3 className="text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
            Decided
          </h3>
          <ul className="list-none space-y-2 p-0">
            {decided.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 border border-[var(--line)] bg-[var(--white)] p-2.5 text-[0.85rem]"
              >
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

      <section aria-label="Matter decision audit">
        <h3 className="text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Decision audit (this matter)
        </h3>
        {decisionEvents.length === 0 ? (
          <p className="text-[0.85rem] text-[var(--muted)]">
            No review decisions recorded for this matter yet.
          </p>
        ) : (
          <ul className="list-none space-y-2 p-0">
            {decisionEvents.map((event) => (
              <li
                key={event.id}
                className="border-l-4 border-[var(--forest)] bg-[var(--white)] px-3 py-2 text-[0.8rem] leading-snug"
              >
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
