"use client";

import { useActionState } from "react";
import { decideReviewAction, type ActionState } from "@/app/app/actions";

/**
 * Human review decision form (§9.6). Decisions are recorded server-side with
 * actor, timestamp, and document-version hash; the server rejects any actor
 * without decision rights at the item's tier.
 */
export function DecisionForm({ reviewItemId }: { reviewItemId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    decideReviewAction,
    null,
  );

  const btn =
    "min-h-[44px] border px-3 text-[0.82rem] font-bold disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <form action={formAction} className="mt-3 border-t border-[var(--line)] pt-3">
      <input type="hidden" name="reviewItemId" value={reviewItemId} />
      <label className="block">
        <span className="mb-1 block text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
          Decision note (recorded in audit log)
        </span>
        <input
          type="text"
          name="note"
          maxLength={4000}
          placeholder="Optional note for the record"
          className="w-full border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.85rem]"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className={`${btn} border-[var(--forest)] bg-[var(--forest)] text-[var(--white)]`}
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="request_changes"
          disabled={pending}
          className={`${btn} border-[#b9a76a] bg-[#f4ecd2] text-[#5d4a12]`}
        >
          Request changes
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className={`${btn} border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]`}
        >
          Reject
        </button>
      </div>
      {state && (
        <p
          role="status"
          className={`mt-2 mb-0 border p-2 text-[0.8rem] ${
            state.ok
              ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
              : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
