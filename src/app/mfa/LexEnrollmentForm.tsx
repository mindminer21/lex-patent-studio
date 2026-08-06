"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  startLexMfaEnrollmentAction,
  verifyLexMfaAction,
  type LexEnrollmentState,
} from "./actions";

export function LexEnrollmentForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LexEnrollmentState, FormData>(
    startLexMfaEnrollmentAction,
    null,
  );
  if (state?.ok) {
    return (
      <div className="mt-4 space-y-4">
        <p>Scan this code with your authenticator app, then enter its six-digit code.</p>
        <Image src={state.qrCode} alt="Authenticator enrollment QR code" width={220} height={220} unoptimized />
        <p className="text-sm text-[var(--muted)]">
          Manual secret: <code>{state.secret}</code>
        </p>
        <form action={verifyLexMfaAction} className="space-y-4">
          <input type="hidden" name="factorId" value={state.factorId} />
          <input type="hidden" name="next" value={state.next} />
          <label className="block text-sm font-semibold" htmlFor="lex-enrollment-code">Six-digit code</label>
          <input className="w-full border border-[var(--line)] p-3" id="lex-enrollment-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          <button className="button" type="submit">Enable authenticator</button>
        </form>
      </div>
    );
  }
  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && <p className="border border-[#a64b3c] bg-[#fff1ef] p-3 text-sm" role="alert">{state.error}</p>}
      <p>Administrative access requires a time-based code from an authenticator app.</p>
      <button className="button" type="submit" disabled={pending}>{pending ? "Starting…" : "Set up authenticator"}</button>
    </form>
  );
}
