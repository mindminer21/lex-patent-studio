"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const REJECTION_MESSAGES: Record<string, string> = {
  mime_not_allowed: "Filing receipts must be PDF, PNG, or JPEG files.",
  extension_mismatch: "The file extension does not match its declared type.",
  too_large: "The file exceeds the size cap for its type.",
  empty_file: "The file is empty.",
  magic_byte_mismatch:
    "The file contents do not match the declared type (signature check failed).",
  already_uploaded: "This upload was already completed.",
  invalid_token: "The upload authorization expired. Please try again.",
};

/**
 * Filing-receipt upload: reuses the existing FR-4 signed-upload pipeline
 * (sign → PUT bytes → quarantine → scan), scoped to one invention record,
 * with kind="filing_receipt" so receipts are listed separately from other
 * private sources. No new upload surface: same allowlist, size caps, and
 * content-signature validation as every other upload.
 */
export default function FilingReceiptUpload({ inventionId }: { inventionId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ kind: "error", text: "Choose a filing receipt file first." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const signResponse = await fetch(`/api/inventions/${inventionId}/uploads/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          declaredBytes: file.size,
          kind: "filing_receipt",
          note: "USPTO filing receipt (uploaded by the user after self-filing)",
        }),
      });
      const signBody = (await signResponse.json()) as { uploadUrl?: string; error?: string };
      if (!signResponse.ok || !signBody.uploadUrl) {
        setMessage({
          kind: "error",
          text: REJECTION_MESSAGES[signBody.error ?? ""] ?? "Upload was rejected.",
        });
        return;
      }
      const putResponse = await fetch(signBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const putBody = (await putResponse.json()) as { error?: string };
      if (!putResponse.ok) {
        setMessage({
          kind: "error",
          text: REJECTION_MESSAGES[putBody.error ?? ""] ?? "Upload was rejected.",
        });
        router.refresh();
        return;
      }
      setMessage({ kind: "ok", text: "Filing receipt uploaded." });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Upload failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const inputId = `filing-receipt-file-${inventionId}`;

  return (
    <form onSubmit={handleSubmit} className="wp-form" data-testid="filing-receipt-form">
      <div className="field">
        <label htmlFor={inputId}>Upload a filing receipt (PDF, PNG, or JPEG)</label>
        <input id={inputId} ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" required />
      </div>
      {message && (
        <p
          className={message.kind === "error" ? "form-error" : "wp-boundary-banner"}
          role={message.kind === "error" ? "alert" : "status"}
          data-testid="filing-receipt-message"
        >
          {message.text}
        </p>
      )}
      <div>
        <button className="button venture-button button-small" type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload filing receipt"}
        </button>
      </div>
      <p className="hint">
        Receipts pass through the same validation, private storage, and quarantine scanning as
        every other upload, and stay scoped to this invention record.
      </p>
    </form>
  );
}
