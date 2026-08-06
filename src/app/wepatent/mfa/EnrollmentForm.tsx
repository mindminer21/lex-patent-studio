"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  startMfaEnrollmentAction,
  verifyMfaAction,
  type EnrollmentState,
} from "./actions";

export function EnrollmentForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<EnrollmentState, FormData>(
    startMfaEnrollmentAction,
    null,
  );
  if (state?.ok) {
    return (
      <div className="signin-form">
        <p>Scan this code with your authenticator app, then enter its six-digit code.</p>
        <Image
          src={state.qrCode}
          alt="Authenticator enrollment QR code"
          width={220}
          height={220}
          unoptimized
        />
        <p className="field-help">
          Can&apos;t scan? Enter this secret manually: <code>{state.secret}</code>
        </p>
        <form action={verifyMfaAction} className="signin-form">
          <input type="hidden" name="factorId" value={state.factorId} />
          <input type="hidden" name="next" value={state.next} />
          <div className="field">
            <label htmlFor="enrollment-code">Six-digit code</label>
            <input
              id="enrollment-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </div>
          <button className="button venture-button" type="submit">
            Enable authenticator
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={action} className="signin-form">
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <p>Administrative access requires a time-based code from an authenticator app.</p>
      <button className="button venture-button" type="submit" disabled={pending}>
        {pending ? "Starting…" : "Set up authenticator"}
      </button>
    </form>
  );
}
