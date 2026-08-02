"use client";

import { useActionState } from "react";
import { postChatMessageAction, type ActionState } from "@/app/app/actions";

export function ChatForm({ matterId }: { matterId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    postChatMessageAction,
    null,
  );
  return (
    <form
      action={formAction}
      aria-label="Ask a grounded question"
      className="border border-[var(--line)] bg-[var(--white)] p-3"
    >
      <input type="hidden" name="matterId" value={matterId} />
      <label htmlFor="chat-q" className="block text-[0.75rem] font-bold">
        Ask about the law or this matter&apos;s record (synthetic content only)
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <textarea
          id="chat-q"
          name="question"
          required
          minLength={3}
          maxLength={2000}
          rows={2}
          placeholder="e.g. What is the grace period for an inventor-originated public demonstration?"
          className="min-w-[260px] flex-1 border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.9rem]"
        />
        <button
          type="submit"
          disabled={pending}
          className="button self-end disabled:opacity-40"
        >
          {pending ? "Retrieving…" : "Ask (grounded)"}
        </button>
      </div>
      {state && !state.ok && (
        <p role="status" className="mb-0 mt-2 border border-[#a05252] bg-[#f6dcdc] p-2 text-[0.8rem] text-[#7c1f1f]">
          {state.message}
        </p>
      )}
    </form>
  );
}
