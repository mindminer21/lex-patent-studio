import { TIER_META, type WorkTier } from "@/lib/domain/tiers";
import {
  REVIEW_STATE_LABELS,
  type ReviewState,
} from "@/lib/domain/review";
import {
  FACT_PROVENANCE_LABELS,
  type FactProvenance,
} from "@/lib/domain/provenance";
import type { RunState } from "@/lib/domain/run-state";
import { DRAFT_WATERMARK } from "@/lib/domain/schemas";

/**
 * Status primitives. Tier, review, draft, and verification labels must stay
 * visible everywhere, including empty states, per PRD §15 and the design
 * handoff. None of these are color-only indicators.
 */

const badgeBase =
  "inline-flex items-center gap-1 border px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] leading-tight";

const TIER_STYLES: Record<WorkTier, string> = {
  A: "border-[#9db6a4] bg-[#e7efe4] text-[#2c4a33]",
  B: "border-[#b9a76a] bg-[#f4ecd2] text-[#5d4a12]",
  C: "border-[#a98080] bg-[#f3e2dd] text-[#6b2f24]",
};

export function TierBadge({ tier, compact = false }: { tier: WorkTier; compact?: boolean }) {
  return (
    <span className={`${badgeBase} ${TIER_STYLES[tier]}`} title={TIER_META[tier].requiredHumanAction}>
      {compact ? `Tier ${tier}` : TIER_META[tier].label}
    </span>
  );
}

const REVIEW_STYLES: Record<ReviewState, string> = {
  pending_review: "border-[#b9a76a] bg-[#f4ecd2] text-[#5d4a12]",
  changes_requested: "border-[#a98080] bg-[#f3e2dd] text-[#6b2f24]",
  approved: "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]",
  rejected: "border-[#8d8d8d] bg-[#e8e6e0] text-[#4a4a4a]",
};

export function ReviewBadge({ state }: { state: ReviewState }) {
  return (
    <span className={`${badgeBase} ${REVIEW_STYLES[state]}`}>
      {REVIEW_STATE_LABELS[state]}
    </span>
  );
}

export function DraftWatermark({ reviewState }: { reviewState: ReviewState }) {
  if (reviewState === "approved") {
    return (
      <span className={`${badgeBase} border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]`}>
        Approved by practitioner
      </span>
    );
  }
  return (
    <span className={`${badgeBase} border-[#8a4a2b] bg-[#f6e3d3] text-[#7a3413]`}>
      {DRAFT_WATERMARK}
    </span>
  );
}

export function VerificationBadge({
  state,
}: {
  state: "unverified" | "verified" | "failed";
}) {
  const styles = {
    verified: "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]",
    unverified: "border-[#9a958a] bg-[#efece3] text-[#5a564c]",
    failed: "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]",
  } as const;
  const labels = {
    verified: "Citations verified",
    unverified: "Verification pending",
    failed: "Verification failed",
  } as const;
  return <span className={`${badgeBase} ${styles[state]}`}>{labels[state]}</span>;
}

export function ProvenanceBadge({ state }: { state: FactProvenance }) {
  const styles: Record<FactProvenance, string> = {
    user_asserted: "border-[#9a958a] bg-[#efece3] text-[#5a564c]",
    source_supported: "border-[#7d94ad] bg-[#e2ebf3] text-[#2c4763]",
    needs_confirmation: "border-[#b9a76a] bg-[#f4ecd2] text-[#5d4a12]",
    disputed: "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]",
    counsel_reviewed: "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]",
  };
  return (
    <span className={`${badgeBase} ${styles[state]}`}>
      {FACT_PROVENANCE_LABELS[state]}
    </span>
  );
}

const RUN_LABELS: Record<RunState, string> = {
  QUEUED: "Queued",
  INGESTING: "Ingesting",
  RETRIEVING: "Retrieving",
  GENERATING: "Generating",
  VERIFYING: "Verifying",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function RunStateBadge({ state }: { state: RunState }) {
  const style =
    state === "COMPLETED"
      ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
      : state === "FAILED" || state === "CANCELLED"
        ? "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
        : "border-[#7d94ad] bg-[#e2ebf3] text-[#2c4763]";
  return <span className={`${badgeBase} ${style}`}>{RUN_LABELS[state]}</span>;
}
