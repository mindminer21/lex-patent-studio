"use client";

import { useActionState } from "react";
import {
  approveFactAction,
  createFactAction,
  type ActionState,
} from "@/app/app/actions";

const CATEGORIES = [
  "problem",
  "solution",
  "component",
  "step",
  "alternative",
  "advantage",
  "contributor",
  "date",
] as const;

function Status({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mb-0 mt-2 border p-2 text-[0.8rem] ${
        state.ok
          ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
          : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
      }`}
    >
      {state.message}
    </p>
  );
}

export function AddFactForm({ matterId }: { matterId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createFactAction,
    null,
  );
  return (
    <form
      action={formAction}
      className="border border-[var(--line)] bg-[var(--white)] p-3"
      aria-label="Add fact"
    >
      <h3 className="m-0 text-[0.95rem] font-bold">Contribute a fact</h3>
      <p className="mb-3 mt-1 text-[0.75rem] text-[var(--muted)]">
        New facts enter the ledger as <strong>user asserted</strong>. Drafting
        draws only on counsel-reviewed facts; everything else is flagged as a
        gap, never filled in.
      </p>
      <input type="hidden" name="matterId" value={matterId} />
      <div className="flex flex-wrap gap-3">
        <label className="block text-[0.75rem] font-bold">
          Category
          <select
            name="category"
            className="mt-1 block min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
            defaultValue="component"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-[260px] flex-1 text-[0.75rem] font-bold">
          Fact text (synthetic content only)
          <textarea
            name="text"
            required
            rows={2}
            maxLength={4000}
            className="mt-1 block w-full border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.85rem] font-normal"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="button mt-2 disabled:opacity-40"
      >
        {pending ? "Adding…" : "Add to ledger"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function ApproveFactButton({
  matterId,
  factId,
}: {
  matterId: string;
  factId: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    approveFactAction,
    null,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="factId" value={factId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-[32px] border border-[#5f7d4f] bg-[var(--white)] px-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#2f4a16] hover:bg-[#e2eecd] disabled:opacity-40"
      >
        {pending ? "Recording…" : "Approve (counsel review)"}
      </button>
      {state && !state.ok && (
        <p role="status" className="mb-0 mt-1 text-[0.7rem] text-[#7c1f1f]">
          {state.message}
        </p>
      )}
    </form>
  );
}
