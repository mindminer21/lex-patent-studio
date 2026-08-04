"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline auto-saving working-title field (design rule: minimize human
 * steps and inputs — the title has NO Save button).
 *
 * - Debounced save ~800 ms after typing stops, plus save on blur.
 * - Escape reverts to the last saved value.
 * - When the current title is an AI proposal (`ai_proposed`), the proposal
 *   is pre-filled with its ai_proposed styling and a hint; blurring
 *   without edits accepts it (that IS the minimal-step acceptance), while
 *   editing then blurring saves the edited version. Provenance
 *   (accepted vs. edited) is decided server-side and recorded in the
 *   working_titles history + ps_events.
 * - Status ("Saving…" / "Saved" / error with retry) is announced through
 *   an aria-live region; the whole flow is keyboard accessible.
 */

type TitleState = "ai_proposed" | "user_confirmed" | "user_edited";

const STATE_LABELS: Record<TitleState, string> = {
  ai_proposed: "AI proposed — awaiting your review",
  user_confirmed: "Confirmed by you",
  user_edited: "Edited by you",
};

const DEBOUNCE_MS = 800;

export default function WorkingTitleField({
  inventionId,
  initialText,
  initialState,
}: {
  inventionId: string;
  initialText: string;
  initialState: TitleState | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [state, setState] = useState<TitleState | null>(initialState);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "invalid">(
    "idle",
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function clearPending(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  async function save(text: string, options: { allowAccept: boolean }): Promise<void> {
    const trimmed = text.trim();
    const isUnchanged = trimmed === savedText.trim();
    // Nothing to persist: unchanged text is only meaningful as an
    // acceptance of a pending AI proposal (on blur).
    if (isUnchanged && (state !== "ai_proposed" || !options.allowAccept)) return;
    if (trimmed.length < 3 || trimmed.length > 400) {
      setStatus("invalid");
      return;
    }
    const seq = ++requestSeqRef.current;
    setStatus("saving");
    try {
      const response = await fetch(`/api/inventions/${inventionId}/working-title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (seq !== requestSeqRef.current) return; // a newer save superseded this one
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const payload = (await response.json()) as {
        title?: { text: string; state: TitleState };
      };
      if (seq !== requestSeqRef.current) return;
      if (!payload.title) {
        setStatus("error");
        return;
      }
      setSavedText(payload.title.text);
      setState(payload.title.state);
      setStatus("saved");
      router.refresh(); // record title + badges elsewhere stay in sync
    } catch {
      if (seq === requestSeqRef.current) setStatus("error");
    }
  }

  function handleChange(next: string): void {
    setValue(next);
    if (status === "invalid" || status === "error") setStatus("idle");
    clearPending();
    // Debounce persists real edits only; accepting an untouched AI
    // proposal is an explicit-ish gesture reserved for blur.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save(next, { allowAccept: false });
    }, DEBOUNCE_MS);
  }

  function handleBlur(): void {
    clearPending();
    void save(value, { allowAccept: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      clearPending();
      requestSeqRef.current += 1; // ignore any in-flight save result
      setValue(savedText);
      setStatus("idle");
    }
  }

  const showProposalHint = state === "ai_proposed" && value === savedText;

  return (
    <div className="wp-title-field">
      <label className="venture-kicker" htmlFor="working-title-input">
        Working title
      </label>
      <input
        id="working-title-input"
        data-testid="working-title"
        className={`wp-title-input${state === "ai_proposed" ? " ai_proposed" : ""}`}
        value={value}
        maxLength={400}
        placeholder="Name your invention — or distill and an AI title is proposed"
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-describedby="working-title-hint working-title-status"
      />
      <p className="hint" id="working-title-hint">
        {showProposalHint
          ? "AI-proposed — edit or click away to keep"
          : "Saves automatically as you type — no Save button."}
      </p>
      <p id="working-title-status" data-testid="title-status" aria-live="polite" className="hint">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "invalid" && "Titles need 3–400 characters — not saved yet."}
        {status === "error" && (
          <>
            Could not save the title.{" "}
            <button
              type="button"
              className="button button-small"
              onClick={() => void save(value, { allowAccept: true })}
            >
              Retry
            </button>
          </>
        )}
      </p>
      {state && (
        <p style={{ marginTop: 4 }}>
          <span
            className={`wp-badge ${state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
          >
            {STATE_LABELS[state]}
          </span>
        </p>
      )}
    </div>
  );
}
