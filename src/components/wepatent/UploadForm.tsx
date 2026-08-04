"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const KIND_OPTIONS = [
  "lab_notebook",
  "design_doc",
  "code",
  "presentation",
  "data",
  "image",
  "other",
];

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
 * Design rule (minimal human input): selecting a file starts the upload —
 * there is no separate "Upload" button. Set kind/note first if you want
 * them recorded; both are optional metadata.
 */
export default function UploadForm({ inventionId }: { inventionId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("design_doc");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function handleFileSelected() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
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
        headers: { "Content-Type": file.type || "application/octet-stream" },
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
        text: `Uploaded ${file.name}. The file is quarantined and will be scanned before extraction.`,
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
        <label htmlFor="upload-kind">Kind (optional — set before choosing a file)</label>
        <select
          id="upload-kind"
          value={kind}
          disabled={busy}
          onChange={(event) => setKind(event.target.value)}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="upload-note">Note (optional — set before choosing a file)</label>
        <input
          id="upload-note"
          value={note}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
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
      <p className="hint">
        Uploads are validated (type allowlist, extension, size, content signature), stored
        privately, quarantined, and scanned before extraction. File contents are treated as
        untrusted data — instructions inside documents carry no authority.
      </p>
    </div>
  );
}
