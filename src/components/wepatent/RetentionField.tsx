"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-saving retention-window field (design rule: minimize human steps
 * and inputs — no "Update retention" button). Debounced save after typing
 * stops plus save on blur; Escape reverts to the last saved value. Every
 * successful save is still owner-gated and audited server-side
 * (updateRetentionPolicy), exactly as before.
 */

const DEBOUNCE_MS = 800;

export default function RetentionField({ initialDays }: { initialDays: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialDays));
  const [savedDays, setSavedDays] = useState(initialDays);
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

  async function save(raw: string): Promise<void> {
    const days = Number(raw.trim());
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      setStatus("invalid");
      return;
    }
    if (days === savedDays) return;
    const seq = ++requestSeqRef.current;
    setStatus("saving");
    try {
      const response = await fetch("/api/settings/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: days }),
      });
      if (seq !== requestSeqRef.current) return;
      if (!response.ok) {
        setStatus("error");
        return;
      }
      setSavedDays(days);
      setStatus("saved");
      router.refresh(); // the organization table above shows the new window
    } catch {
      if (seq === requestSeqRef.current) setStatus("error");
    }
  }

  function handleChange(next: string): void {
    setValue(next);
    if (status === "invalid" || status === "error") setStatus("idle");
    clearPending();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save(next);
    }, DEBOUNCE_MS);
  }

  return (
    <div>
      <div className="wp-autosave-inline">
        <label htmlFor="retention-days">Retention window (days)</label>
        <input
          id="retention-days"
          data-testid="retention-days"
          type="number"
          min={30}
          max={3650}
          value={value}
          style={{ width: 110 }}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => {
            clearPending();
            void save(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              clearPending();
              requestSeqRef.current += 1;
              setValue(String(savedDays));
              setStatus("idle");
            }
          }}
          aria-describedby="retention-status"
        />
        <span id="retention-status" data-testid="retention-status" aria-live="polite" className="hint">
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved and audited"}
          {status === "invalid" && "Retention must be 30–3650 days — not saved."}
          {status === "error" && (
            <>
              Could not save.{" "}
              <button
                type="button"
                className="button button-small"
                onClick={() => void save(value)}
              >
                Retry
              </button>
            </>
          )}
        </span>
      </div>
      <p className="hint">Saves automatically — changes are audited.</p>
    </div>
  );
}
