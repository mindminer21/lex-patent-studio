"use client";

import { useActionState } from "react";
import { signUploadAction, type ActionState } from "@/app/app/actions";

const CONTENT_TYPES = [
  ["application/pdf", "PDF"],
  ["text/plain", "Plain text"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "DOCX",
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "XLSX",
  ],
] as const;

export function UploadSignForm({ matterId }: { matterId: string }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    signUploadAction,
    null,
  );
  return (
    <form
      action={formAction}
      className="border border-[var(--line)] bg-[var(--white)] p-3"
      aria-label="Request signed upload"
    >
      <h3 className="m-0 text-[0.95rem] font-bold">Request a signed upload target</h3>
      <p className="mb-3 mt-1 text-[0.75rem] text-[var(--muted)]">
        Local mode issues a SIMULATED signed target and accepts no bytes. In
        production, uploads pass validation, malware scanning, and quarantine
        before async extraction (FR-4).
      </p>
      <input type="hidden" name="matterId" value={matterId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[200px] flex-1 text-[0.75rem] font-bold">
          File name
          <input
            name="fileName"
            required
            maxLength={255}
            placeholder="disclosure-draft.pdf"
            className="mt-1 block w-full min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          />
        </label>
        <label className="block text-[0.75rem] font-bold">
          Type
          <select
            name="contentType"
            className="mt-1 block min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          >
            {CONTENT_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[0.75rem] font-bold">
          Size (bytes)
          <input
            name="sizeBytes"
            type="number"
            min={1}
            max={50 * 1024 * 1024}
            defaultValue={1048576}
            required
            className="mt-1 block w-36 min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          />
        </label>
        <button type="submit" disabled={pending} className="button disabled:opacity-40">
          {pending ? "Signing…" : "Sign upload"}
        </button>
      </div>
      {state && (
        <p
          role="status"
          className={`mb-0 mt-3 border p-2 text-[0.8rem] break-all ${
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
