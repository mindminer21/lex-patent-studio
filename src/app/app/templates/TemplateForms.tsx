"use client";

import { useActionState } from "react";
import {
  createStyleProfileAction,
  publishPlaybookAction,
  type ActionState,
} from "@/app/app/actions";

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

export function CreateStyleProfileForm() {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createStyleProfileAction,
    null,
  );
  return (
    <form
      action={formAction}
      aria-label="Create style profile"
      className="border border-[var(--line)] bg-[var(--white)] p-3"
    >
      <h3 className="m-0 text-[0.95rem] font-bold">New style profile</h3>
      <p className="mb-3 mt-1 text-[0.75rem] text-[var(--muted)]">
        Rules apply to all generation in this tenant. Each run records the
        exact profile version it used.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[220px] text-[0.75rem] font-bold">
          Profile name
          <input
            name="name"
            required
            maxLength={200}
            className="mt-1 block w-full min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          />
        </label>
        <label className="block text-[0.75rem] font-bold">
          Kind
          <select
            name="kind"
            defaultValue="application_drafting"
            className="mt-1 block min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          >
            <option value="application_drafting">Application drafting</option>
            <option value="search_report">Search report</option>
            <option value="oa_response">OA response conventions</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block text-[0.75rem] font-bold">
        Style rules — one per line (max 24)
        <textarea
          name="rulesText"
          required
          rows={4}
          maxLength={8000}
          placeholder={"Prefer 'configured to' over means-plus-function phrasing.\nIntroduce every claim element in the specification before first claim use."}
          className="mt-1 block w-full border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.85rem] font-normal"
        />
      </label>
      <button type="submit" disabled={pending} className="button mt-2 disabled:opacity-40">
        {pending ? "Creating…" : "Create profile"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function PublishPlaybookForm() {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    publishPlaybookAction,
    null,
  );
  return (
    <form
      action={formAction}
      aria-label="Publish playbook entry"
      className="border border-[var(--line)] bg-[var(--white)] p-3"
    >
      <h3 className="m-0 text-[0.95rem] font-bold">Publish a playbook entry</h3>
      <p className="mb-3 mt-1 text-[0.75rem] text-[var(--muted)]">
        Publication records your identity and timestamp, hashes the content,
        and chains it to the previous entry. Published entries are immutable
        and never leave this tenant.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[260px] flex-1 text-[0.75rem] font-bold">
          Title
          <input
            name="title"
            required
            maxLength={300}
            className="mt-1 block w-full min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          />
        </label>
        <label className="block text-[0.75rem] font-bold">
          Category
          <select
            name="category"
            defaultValue="approved_argument"
            className="mt-1 block min-h-[44px] border border-[var(--line)] bg-[var(--white)] px-2 text-[0.85rem] font-normal"
          >
            <option value="approved_argument">Approved argument</option>
            <option value="claim_structure">Preferred claim structure</option>
            <option value="examiner_note">Examiner-specific note</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block text-[0.75rem] font-bold">
        Entry body (synthetic content only)
        <textarea
          name="body"
          required
          rows={3}
          maxLength={8000}
          className="mt-1 block w-full border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.85rem] font-normal"
        />
      </label>
      <button type="submit" disabled={pending} className="button mt-2 disabled:opacity-40">
        {pending ? "Publishing…" : "Publish (immutable)"}
      </button>
      <Status state={state} />
    </form>
  );
}
