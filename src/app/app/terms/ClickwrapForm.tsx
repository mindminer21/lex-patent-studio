"use client";

import { useState } from "react";
import { ACKNOWLEDGEMENTS, CURRENT_TERMS_VERSION } from "@/lib/domain/clickwrap";
import { acceptTermsAction } from "./actions";

/**
 * Keyboard-accessible clickwrap: native checkboxes with visible labels; the
 * Continue button stays disabled until every acknowledgement is checked.
 * The server action re-validates independently — client state alone is
 * never sufficient (PRD §7.2).
 */
export default function ClickwrapForm({ error }: { error?: string }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked = ACKNOWLEDGEMENTS.every((ack) => checked[ack.key]);

  return (
    <form action={acceptTermsAction} aria-describedby="clickwrap-note">
      <input type="hidden" name="termsVersion" value={CURRENT_TERMS_VERSION} />
      {error && (
        <p className="form-error" role="alert">
          {error === "missing_acknowledgements"
            ? "All four acknowledgements are required."
            : error === "version_mismatch"
              ? "The terms changed while you were reading. Please review the current version below."
              : "Something went wrong recording your acceptance. Please try again."}
        </p>
      )}
      <div className="acknowledgements">
        {ACKNOWLEDGEMENTS.map((ack) => (
          <label className="acknowledgement" key={ack.key}>
            <input
              type="checkbox"
              name={`ack_${ack.key}`}
              checked={Boolean(checked[ack.key])}
              onChange={(event) =>
                setChecked((current) => ({ ...current, [ack.key]: event.target.checked }))
              }
            />
            <span>{ack.text}</span>
          </label>
        ))}
      </div>
      <p className="consent-legal" id="clickwrap-note">
        By continuing you accept Self-Service Terms version {CURRENT_TERMS_VERSION}. Your
        acceptance is recorded server-side with a timestamp, terms version, acknowledgement set,
        hashed network identifier, and browser category.
      </p>
      <button className="button venture-button" type="submit" disabled={!allChecked}>
        Continue to the workspace
      </button>
    </form>
  );
}
