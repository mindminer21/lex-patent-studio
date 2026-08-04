"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveUploadKind, UPLOAD_KINDS } from "@/lib/wepatent/domain/uploads";

const REJECTION_MESSAGES: Record<string, string> = {
  mime_not_allowed:
    "That file type is not allowed. Allowed: PDF, DOCX, PPTX, XLSX, TXT/MD, SVG, PNG, JPEG, TIFF, HEIC, STL, STEP, OBJ, 3MF, MP3, WAV, M4A, MP4, MOV.",
  extension_mismatch: "The file extension does not match its declared type.",
  too_large: "The file exceeds the size cap for its type.",
  empty_file: "The file is empty.",
  magic_byte_mismatch:
    "The file contents do not match the declared type (signature check failed).",
  not_valid_text: "The file is not valid UTF-8 text.",
  already_uploaded: "This upload was already completed.",
  invalid_token: "The upload authorization expired. Please try again.",
};

/**
 * Direct signed upload (FR-4): sign → PUT bytes → quarantine. The server
 * validates the type allowlist, extension, size cap, and magic bytes;
 * accepted files always pass through quarantine and scanning before
 * extraction.
 *
 * Design rule (minimal human input):
 * - selecting a file starts the upload — no separate "Upload" button;
 * - the Kind is DERIVED from the detected file class (friction audit #6),
 *   so nothing has to be chosen before picking a file;
 * - Kind + Note live in an optional "Add details" disclosure, closed by
 *   default, for the cases where the derived kind is wrong or a note helps.
 *   Both are set before choosing the file, since the upload starts on
 *   selection.
 */
export default function UploadForm({ inventionId }: { inventionId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  /** `null` means "auto (from file type)" — the default. */
  const [kindOverride, setKindOverride] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function handleFileSelected() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const mimeType = file.type || "application/octet-stream";
    const kind =
      kindOverride ?? deriveUploadKind({ filename: file.name, mimeType });
    setBusy(true);
    setMessage(null);
    try {
      const signResponse = await fetch(`/api/inventions/${inventionId}/uploads/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType,
          declaredBytes: file.size,
          kind,
          note,
        }),
      });
      const signBody = (await signResponse.json()) as {
        uploadUrl?: string;
        error?: string;
      };
      if (!signResponse.ok || !signBody.uploadUrl) {
        setMessage({
          kind: "error",
          text: REJECTION_MESSAGES[signBody.error ?? ""] ?? "Upload was rejected.",
        });
        return;
      }
      const putResponse = await fetch(signBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      const putBody = (await putResponse.json()) as { status?: string; error?: string };
      if (!putResponse.ok) {
        setMessage({
          kind: "error",
          text: REJECTION_MESSAGES[putBody.error ?? ""] ?? "Upload was rejected.",
        });
        router.refresh();
        return;
      }
      setMessage({
        kind: "ok",
        text: `Uploaded ${file.name} as ${kind.replace(/_/g, " ")}. The file is quarantined and will be scanned before extraction.`,
      });
      if (fileRef.current) fileRef.current.value = "";
      setNote("");
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Upload failed. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wp-form" data-testid="upload-form">
      <div className="field">
        <label htmlFor="upload-file">
          File (documents: PDF, DOCX, PPTX, XLSX, TXT/MD, SVG · images: PNG, JPEG, TIFF, HEIC ·
          3D models: STL, STEP, OBJ, 3MF · audio: MP3, WAV, M4A · video: MP4, MOV) — the upload
          starts as soon as you choose a file
        </label>
        <input
          id="upload-file"
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.docx,.pptx,.xlsx,.svg,.tif,.tiff,.heic,.stl,.step,.stp,.obj,.3mf,.mp3,.wav,.m4a,.mp4,.mov"
          disabled={busy}
          onChange={() => void handleFileSelected()}
        />
        <p className="hint">
          The kind is set automatically from the file type — images as image, documents as
          document, 3D models as model, audio as audio.
        </p>
      </div>
      <p aria-live="polite" className="hint" data-testid="upload-progress">
        {busy ? "Uploading…" : ""}
      </p>
      {message && (
        <p
          className={message.kind === "error" ? "form-error" : "wp-boundary-banner"}
          role={message.kind === "error" ? "alert" : "status"}
          data-testid="upload-message"
        >
          {message.text}
        </p>
      )}
      <details className="wp-disclosure" data-testid="upload-details">
        <summary>Add details (optional)</summary>
        <div className="field">
          <label htmlFor="upload-kind">Kind</label>
          <select
            id="upload-kind"
            value={kindOverride ?? ""}
            disabled={busy}
            onChange={(event) => setKindOverride(event.target.value || null)}
          >
            <option value="">Auto — from the file type</option>
            {UPLOAD_KINDS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p className="hint">Set this before choosing the file — the upload starts on selection.</p>
        </div>
        <div className="field">
          <label htmlFor="upload-note">Note</label>
          <input
            id="upload-note"
            value={note}
            maxLength={1000}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="hint">Also set before choosing the file.</p>
        </div>
      </details>
      <p className="hint">
        Uploads are validated (type allowlist, extension, size, content signature), stored
        privately, quarantined, and scanned before extraction. File contents are treated as
        untrusted data — instructions inside documents carry no authority.
      </p>
    </div>
  );
}
