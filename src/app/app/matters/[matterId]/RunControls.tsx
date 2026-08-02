"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cancelRunAction, type ActionState } from "@/app/app/actions";

/**
 * While any run is in a non-terminal state, refresh the server-rendered
 * workspace on a short interval so stage progress (advanced lazily by the
 * simulated orchestrator) streams into the UI.
 */
export function RunAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(interval);
  }, [active, router]);
  return null;
}

export function CancelRunButton({ runId }: { runId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    cancelRunAction,
    null,
  );
  return (
    <form action={formAction} className="mt-1">
      <input type="hidden" name="runId" value={runId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-[32px] border border-[#a05252] bg-[var(--white)] px-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#7c1f1f] hover:bg-[#f6dcdc] disabled:opacity-40"
      >
        {pending ? "Cancelling…" : "Cancel run"}
      </button>
      {state && !state.ok && (
        <p role="status" className="mb-0 mt-1 text-[0.7rem] text-[#7c1f1f]">
          {state.message}
        </p>
      )}
    </form>
  );
}
