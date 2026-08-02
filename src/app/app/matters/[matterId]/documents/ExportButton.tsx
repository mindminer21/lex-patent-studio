"use client";

import { useActionState } from "react";
import { exportDocumentAction, type ActionState } from "@/app/app/actions";

export function ExportButton({ documentId }: { documentId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    exportDocumentAction,
    null,
  );
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="documentId" value={documentId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-[36px] border border-[var(--forest)] bg-[var(--white)] px-3 text-[0.78rem] font-bold text-[var(--forest)] hover:bg-[#eef3e2] disabled:opacity-40"
      >
        {pending ? "Exporting…" : "Export DOCX + manifest"}
      </button>
      {state && (
        <p
          role="status"
          className={`mb-0 mt-1 max-w-[420px] text-[0.72rem] ${
            state.ok ? "text-[#2f4a16]" : "text-[#7c1f1f]"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
