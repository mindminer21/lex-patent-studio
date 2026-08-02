import type { SourceStatus } from "@/lib/server/adapters/types";

/**
 * FR-4 upload validation and quarantine rules.
 *
 * - Allowlisted MIME types only, each pinned to allowed extensions, a size
 *   cap, and (where the format has one) a magic-byte signature.
 * - Unsupported types and oversized uploads are rejected BEFORE processing
 *   (PRD §7.3); every accepted byte stream still lands in quarantine and
 *   must pass the scan step before extraction.
 * - Instructions inside uploaded documents are content, never authority
 *   (PRD §11) — nothing here executes or interprets file contents beyond
 *   signature checks.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB global ceiling

export type AllowedUploadType = {
  mimeType: string;
  extensions: readonly string[];
  maxBytes: number;
  /** Leading byte signature(s); empty means text validated as UTF-8. */
  magic: readonly (readonly number[])[];
};

export const ALLOWED_UPLOAD_TYPES: readonly AllowedUploadType[] = [
  {
    mimeType: "application/pdf",
    extensions: [".pdf"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  },
  {
    mimeType: "image/png",
    extensions: [".png"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    mimeType: "text/plain",
    extensions: [".txt", ".md"],
    maxBytes: 2 * 1024 * 1024,
    magic: [],
  },
  {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [[0x50, 0x4b, 0x03, 0x04]], // ZIP local file header
  },
] as const;

export type UploadRejection =
  | "mime_not_allowed"
  | "extension_mismatch"
  | "too_large"
  | "empty_file"
  | "magic_byte_mismatch"
  | "not_valid_text";

export function getAllowedType(mimeType: string): AllowedUploadType | null {
  return ALLOWED_UPLOAD_TYPES.find((t) => t.mimeType === mimeType.toLowerCase()) ?? null;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

/** Pre-upload (sign-time) validation: type, extension, declared size. */
export function validateUploadRequest(input: {
  filename: string;
  mimeType: string;
  declaredBytes: number;
}): { ok: true; type: AllowedUploadType } | { ok: false; reason: UploadRejection } {
  const type = getAllowedType(input.mimeType);
  if (!type) return { ok: false, reason: "mime_not_allowed" };
  if (!type.extensions.includes(extensionOf(input.filename))) {
    return { ok: false, reason: "extension_mismatch" };
  }
  if (input.declaredBytes <= 0) return { ok: false, reason: "empty_file" };
  if (input.declaredBytes > type.maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, type };
}

function matchesMagic(bytes: Uint8Array, signatures: readonly (readonly number[])[]): boolean {
  return signatures.some(
    (signature) =>
      bytes.length >= signature.length &&
      signature.every((expected, index) => bytes[index] === expected),
  );
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Byte-level validation on receipt: size cap, magic bytes, text validity. */
export function validateUploadBytes(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): { ok: true; type: AllowedUploadType } | { ok: false; reason: UploadRejection } {
  const request = validateUploadRequest({
    filename: input.filename,
    mimeType: input.mimeType,
    declaredBytes: input.bytes.length,
  });
  if (!request.ok) return request;
  const { type } = request;
  if (type.magic.length > 0 && !matchesMagic(input.bytes, type.magic)) {
    return { ok: false, reason: "magic_byte_mismatch" };
  }
  if (type.magic.length === 0 && !isValidUtf8(input.bytes)) {
    return { ok: false, reason: "not_valid_text" };
  }
  return { ok: true, type };
}

/**
 * Quarantine/extraction state machine (FR-4). `registered` is a metadata
 * row; bytes move it to `uploaded` and immediately into `quarantined`; only
 * a passed scan releases it to `scanned`; extraction is asynchronous.
 * `rejected` is terminal.
 */
const SOURCE_TRANSITIONS: Record<SourceStatus, readonly SourceStatus[]> = {
  registered: ["uploaded", "rejected"],
  uploaded: ["quarantined", "rejected"],
  quarantined: ["scanned", "rejected"],
  scanned: ["extracted", "rejected"],
  extracted: [],
  rejected: [],
};

export function canTransitionSource(from: SourceStatus, to: SourceStatus): boolean {
  return SOURCE_TRANSITIONS[from].includes(to);
}

/**
 * Local scan stub with the industry-standard EICAR test signature so the
 * quarantine → rejected path is actually exercisable without a real
 * scanning vendor (approval-gated external service in production).
 */
const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";

export function scanBytes(bytes: Uint8Array): { clean: boolean; reason: string | null } {
  const probe = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, 4096),
  );
  if (probe.includes(EICAR_SIGNATURE)) {
    return { clean: false, reason: "malware_signature_detected (EICAR test signature)" };
  }
  return { clean: true, reason: null };
}
