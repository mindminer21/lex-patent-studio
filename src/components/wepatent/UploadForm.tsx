"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveUploadKind, UPLOAD_KINDS } from "@/lib/wepatent/domain/uploads";
import {
  useUploadStatusStore,
  type UploadMessage,
} from "@/components/wepatent/UploadStatusProvider";

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

/** The FR-4 allowlist, shared by both variants of this control. */
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.txt,.md,.docx,.pptx,.xlsx,.svg,.tif,.tiff,.heic,.stl,.step,.stp,.obj,.3mf,.mp3,.wav,.m4a,.mp4,.mov";

/** Jeff's copy, verbatim — do not reword. */
export const DROPZONE_LABEL = "Upload Anything About the Invention";

const FORMATS_LINE =
  "Documents (PDF, DOCX, PPTX, XLSX, TXT/MD, SVG) · images (PNG, JPEG, TIFF, HEIC) · 3D models (STL, STEP, OBJ, 3MF) · audio (MP3, WAV, M4A) · video (MP4, MOV).";

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
 *
 * Two variants, ONE pipeline:
 * - `"compact"` (default) — the in-workspace control described above.
 * - `"dropzone"` — the empty-record first-run surface (Jeff's direction,
 *   2026-08-04): one large drag-and-drop area labeled "Upload Anything
 *   About the Invention", no Kind/Note prompt at all, accepted formats
 *   demoted to a closed disclosure. The file input is a real, labeled,
 *   Tab-reachable `<input type="file">` (Enter/Space opens the picker),
 *   and upload start is announced through the same aria-live region.
 */
export default function UploadForm({
  inventionId,
  variant = "compact",
}: {
  inventionId: string;
  variant?: "compact" | "dropzone";
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  /** `null` means "auto (from file type)" — the default. */
  const [kindOverride, setKindOverride] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Progress + confirmation live in the shared store when one is present,
  // so they survive the automatic first-run → workspace remount; local
  // state otherwise (behavior unchanged wherever there is no provider).
  const shared = useUploadStatusStore();
  const [localBusyName, setLocalBusyName] = useState("");
  const [localMessage, setLocalMessage] = useState<UploadMessage>(null);
  const busyName = shared ? shared.busyName : localBusyName;
  const setBusyName = shared ? shared.setBusyName : setLocalBusyName;
  const message = shared ? shared.message : localMessage;
  const setMessage = shared ? shared.setMessage : setLocalMessage;
  const dropzone = variant === "dropzone";

  async function uploadOne(file: File): Promise<void> {
    const mimeType = file.type || "application/octet-stream";
    // In the dropzone variant there is no Kind/Note prompt at all, so the
    // kind is always the auto-derived one.
    const kind = (dropzone ? null : kindOverride) ?? deriveUploadKind({ filename: file.name, mimeType });
    setBusy(true);
    setBusyName(file.name);
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
          note: dropzone ? "" : note,
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
      // The first accepted upload makes the record non-empty, so this
      // refresh is also what swaps the first-run surface for the full
      // Studio and its tab navigation — no user action required.
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Upload failed. Please try again." });
    } finally {
      setBusy(false);
      setBusyName("");
    }
  }

  async function handleFileSelected() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    await uploadOne(file);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await uploadOne(file);
  }

  const status = (
    <>
      <p aria-live="polite" className="hint" data-testid="upload-progress">
        {busy ? `Uploading ${busyName}…` : ""}
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
    </>
  );

  if (dropzone) {
    return (
      <div
        className={`wp-dropzone${dragging ? " dragging" : ""}`}
        data-testid="upload-dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void handleDrop(event)}
      >
        {/* A real, labeled file input — Tab reaches it, Enter/Space opens
            the picker, and the label is its accessible name. Dragging a
            file onto the area does exactly the same thing. */}
        <label className="wp-dropzone-label" htmlFor="upload-file">
          {DROPZONE_LABEL}
        </label>
        <p className="wp-dropzone-hint">
          Drag files here, or choose one below — the upload starts as soon as you do.
        </p>
        <input
          id="upload-file"
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={() => void handleFileSelected()}
        />
        {status}
        <details className="wp-disclosure" data-testid="upload-formats">
          <summary>Accepted formats and how files are handled</summary>
          <p className="hint">{FORMATS_LINE}</p>
          <p className="hint">
            Every file is validated (type allowlist, extension, size, content signature), stored
            privately, quarantined, and scanned before extraction. File contents are treated as
            untrusted data — instructions inside documents carry no authority. The kind is set
            automatically from the file type.
          </p>
        </details>
      </div>
    );
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
          accept={ACCEPT}
          disabled={busy}
          onChange={() => void handleFileSelected()}
        />
        <p className="hint">
          The kind is set automatically from the file type — images as image, documents as
          document, 3D models as model, audio as audio.
        </p>
      </div>
      {status}
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
