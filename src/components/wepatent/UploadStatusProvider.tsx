"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type UploadMessage = { kind: "error" | "ok"; text: string } | null;

export type UploadStatusStore = {
  busyName: string;
  setBusyName: (value: string) => void;
  message: UploadMessage;
  setMessage: (value: UploadMessage) => void;
};

const UploadStatusContext = createContext<UploadStatusStore | null>(null);

/**
 * Keeps the upload confirmation alive across the automatic first-run →
 * workspace transition.
 *
 * The Studio renders a completely different tree once a record stops being
 * empty, which remounts the upload control and would otherwise wipe the
 * "Uploaded memo.md as document" confirmation the instant it appeared.
 * Since the transition is deliberately automatic (no "continue" step), that
 * confirmation is the user's only feedback that the named file was
 * accepted, so the state lives here — one element at a stable position that
 * survives `router.refresh()` — instead of inside the control.
 *
 * The context is OPTIONAL: `UploadForm` falls back to local state wherever
 * no provider wraps it (e.g. the Sources page), so behavior there is
 * unchanged.
 */
export function UploadStatusProvider({ children }: { children: ReactNode }) {
  const [busyName, setBusyName] = useState("");
  const [message, setMessage] = useState<UploadMessage>(null);
  const value = useMemo<UploadStatusStore>(
    () => ({ busyName, setBusyName, message, setMessage }),
    [busyName, message],
  );
  return (
    <UploadStatusContext.Provider value={value}>{children}</UploadStatusContext.Provider>
  );
}

export function useUploadStatusStore(): UploadStatusStore | null {
  return useContext(UploadStatusContext);
}
