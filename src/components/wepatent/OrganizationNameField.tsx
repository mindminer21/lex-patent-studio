"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-saving organization-name field (design rule: minimal human input).
 *
 * The first organization is created automatically on first sign-in with a
 * placeholder name derived from the user's email — the blocking "Create
 * your organization" step is gone. This field is where the placeholder
 * becomes the real name: debounced save ~800 ms after typing stops, save on
 * blur, Escape reverts, aria-live "Saving…/Saved/error + Retry" status.
 * Server-side the change is still owner-gated (`org.manage`),
 * bounds-checked (2–120), and audited.
 */

const DEBOUNCE_MS = 800;

export default function OrganizationNameField({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "invalid">("idle");
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

  async function save(raw: string): Promise<void> {
    const name = raw.trim();
    if (name === savedName.trim()) return;
    if (name.length < 2 || name.length > 120) {
      setStatus("invalid");
      return;
    }
    const seq = ++requestSeqRef.current;
    setStatus("saving");
    try {
      const response = await fetch("/api/settings/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (seq !== requestSeqRef.current) return;
      if (!response.ok) {
        setStatus("error");
        return;
      }
      setSavedName(name);
      setStatus("saved");
      router.refresh(); // the topbar and org table show the new name
    } catch {
      if (seq === requestSeqRef.current) setStatus("error");
    }
  }

  return (
    <div>
      <div className="wp-autosave-inline">
        <label htmlFor="organization-name">Organization name</label>
        <input
          id="organization-name"
          data-testid="organization-name"
          type="text"
          value={value}
          maxLength={120}
          style={{ minWidth: 240 }}
          onChange={(event) => {
            setValue(event.target.value);
            if (status === "invalid" || status === "error") setStatus("idle");
            clearPending();
            timerRef.current = setTimeout(() => {
              timerRef.current = null;
              void save(event.target.value);
            }, DEBOUNCE_MS);
          }}
          onBlur={() => {
            clearPending();
            void save(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              clearPending();
              requestSeqRef.current += 1;
              setValue(savedName);
              setStatus("idle");
            }
          }}
          aria-describedby="organization-name-status"
        />
        <span
          id="organization-name-status"
          data-testid="organization-name-status"
          aria-live="polite"
          className="hint"
        >
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved and audited"}
          {status === "invalid" && "Names need 2–120 characters — not saved."}
          {status === "error" && (
            <>
              Could not save.{" "}
              <button type="button" className="button button-small" onClick={() => void save(value)}>
                Retry
              </button>
            </>
          )}
        </span>
      </div>
      <p className="hint">
        Saves automatically — changes are audited. Your workspace was created with a placeholder
        name; this is where you make it yours.
      </p>
    </div>
  );
}
