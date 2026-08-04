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

/**
 * Interpretation capability class (Intake Studio PRD §5.1, FR-INT-2).
 * Determines which interpretation path a CLEAN, SCANNED file may take:
 * - `document`: text/structure extraction feeds the model interpretation pass
 * - `image`: vision-model description (server-side only)
 * - `model3d`: accepted + stored; a clean pure-code parse yields a
 *   deterministic geometry summary (M2); browser-rendered snapshot views can
 *   be captured as derived image sources for vision interpretation (M3)
 * - `audio`: transcription through the server-side gateway (M3, §5.1
 *   Phase 2); the transcript becomes a `transcript` extraction artifact
 * - `video`: accepted + stored; audio-track/keyframe interpretation is not
 *   yet available, so video is honestly `stored_uninterpreted` with a
 *   prompt to describe its contents (the PRD's honest path)
 * - `stored_only`: accepted + stored, never auto-interpreted
 */
export type InterpretationClass =
  | "document"
  | "image"
  | "model3d"
  | "audio"
  | "video"
  | "stored_only";

/** A byte signature checked at a fixed offset (HEIC's lives at offset 4). */
export type MagicSignature = { offset: number; bytes: readonly number[] };

export type AllowedUploadType = {
  mimeType: string;
  extensions: readonly string[];
  maxBytes: number;
  /** Content signature(s); empty means text validated as UTF-8. */
  magic: readonly MagicSignature[];
  /**
   * `binary: true` marks formats with no reliable signature AND non-text
   * bodies (binary STL). They skip UTF-8 validation but still pass size
   * caps, extension pinning, quarantine, and the malware scan.
   */
  binary?: boolean;
  /**
   * Browsers report many CAD/3D formats as application/octet-stream (or
   * nothing). Entries with this flag also match by extension when the
   * declared type is octet-stream — the magic/size checks still apply.
   */
  acceptOctetStream?: boolean;
  interpretation: InterpretationClass;
};

const ZIP_MAGIC: readonly MagicSignature[] = [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }];

export const ALLOWED_UPLOAD_TYPES: readonly AllowedUploadType[] = [
  // --- Text documents ------------------------------------------------------
  {
    mimeType: "application/pdf",
    extensions: [".pdf"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }], // %PDF-
    interpretation: "document",
  },
  {
    mimeType: "text/plain",
    extensions: [".txt", ".md"],
    maxBytes: 2 * 1024 * 1024,
    magic: [],
    interpretation: "document",
  },
  {
    mimeType: "text/markdown",
    extensions: [".md"],
    maxBytes: 2 * 1024 * 1024,
    magic: [],
    interpretation: "document",
  },
  {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: ZIP_MAGIC,
    interpretation: "document",
  },
  {
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: [".pptx"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: ZIP_MAGIC,
    interpretation: "document",
  },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: [".xlsx"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: ZIP_MAGIC,
    interpretation: "document",
  },
  // SVG is XML text; it is read as a document (its markup is its content).
  {
    mimeType: "image/svg+xml",
    extensions: [".svg"],
    maxBytes: 2 * 1024 * 1024,
    magic: [],
    interpretation: "document",
  },
  // --- Images (vision interpretation) --------------------------------------
  {
    mimeType: "image/png",
    extensions: [".png"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    interpretation: "image",
  },
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    interpretation: "image",
  },
  {
    mimeType: "image/tiff",
    extensions: [".tif", ".tiff"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [
      { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, // II*\0 little-endian
      { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // MM\0* big-endian
    ],
    interpretation: "image",
  },
  {
    mimeType: "image/heic",
    extensions: [".heic"],
    maxBytes: MAX_UPLOAD_BYTES,
    // ISO-BMFF: 'ftypheic' at offset 4.
    magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63] }],
    interpretation: "image",
  },
  // --- 3D models (accepted + stored; M1 marks them stored_uninterpreted) ---
  {
    mimeType: "model/stl",
    extensions: [".stl"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [],
    binary: true, // binary STL has no signature; ASCII STL also passes
    acceptOctetStream: true,
    interpretation: "model3d",
  },
  {
    mimeType: "model/step",
    extensions: [".step", ".stp"],
    maxBytes: MAX_UPLOAD_BYTES,
    // ISO-10303-21 header.
    magic: [
      {
        offset: 0,
        bytes: [0x49, 0x53, 0x4f, 0x2d, 0x31, 0x30, 0x33, 0x30, 0x33, 0x2d, 0x32, 0x31],
      },
    ],
    acceptOctetStream: true,
    interpretation: "model3d",
  },
  {
    mimeType: "model/obj",
    extensions: [".obj"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [], // OBJ is plain text
    acceptOctetStream: true,
    interpretation: "model3d",
  },
  {
    mimeType: "model/3mf",
    extensions: [".3mf"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: ZIP_MAGIC,
    acceptOctetStream: true,
    interpretation: "model3d",
  },
  // --- Audio (M3 §5.1 Phase 2: server-side transcription) ------------------
  {
    mimeType: "audio/mpeg",
    extensions: [".mp3"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [
      { offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3 tag
      { offset: 0, bytes: [0xff, 0xfb] }, // MPEG-1 layer III frame sync
      { offset: 0, bytes: [0xff, 0xf3] }, // MPEG-2 layer III
      { offset: 0, bytes: [0xff, 0xf2] }, // MPEG-2 layer III (no CRC)
    ],
    acceptOctetStream: true,
    interpretation: "audio",
  },
  {
    mimeType: "audio/wav",
    extensions: [".wav"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }], // RIFF
    acceptOctetStream: true,
    interpretation: "audio",
  },
  {
    mimeType: "audio/x-wav",
    extensions: [".wav"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
    interpretation: "audio",
  },
  {
    mimeType: "audio/mp4",
    extensions: [".m4a"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // ISO-BMFF ftyp
    acceptOctetStream: true,
    interpretation: "audio",
  },
  {
    mimeType: "audio/x-m4a",
    extensions: [".m4a"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
    interpretation: "audio",
  },
  // --- Video (M3): stored + honest status; no transcode/keyframe worker ----
  {
    mimeType: "video/mp4",
    extensions: [".mp4"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
    acceptOctetStream: true,
    interpretation: "video",
  },
  {
    mimeType: "video/quicktime",
    extensions: [".mov"],
    maxBytes: MAX_UPLOAD_BYTES,
    magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
    acceptOctetStream: true,
    interpretation: "video",
  },
] as const;

export type UploadRejection =
  | "mime_not_allowed"
  | "extension_mismatch"
  | "too_large"
  | "empty_file"
  | "magic_byte_mismatch"
  | "not_valid_text";

export function getAllowedType(mimeType: string, filename?: string): AllowedUploadType | null {
  const normalized = mimeType.toLowerCase();
  const byMime = ALLOWED_UPLOAD_TYPES.find((t) => t.mimeType === normalized) ?? null;
  if (byMime) return byMime;
  // Browsers report 3D/CAD formats as octet-stream (or nothing); fall back
  // to extension lookup for the entries that explicitly opt in. All content
  // validation (size, signature, scan, quarantine) still applies.
  if (normalized === "application/octet-stream" && filename) {
    const extension = extensionOf(filename);
    return (
      ALLOWED_UPLOAD_TYPES.find(
        (t) => t.acceptOctetStream && t.extensions.includes(extension),
      ) ?? null
    );
  }
  return null;
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
  const type = getAllowedType(input.mimeType, input.filename);
  if (!type) return { ok: false, reason: "mime_not_allowed" };
  if (!type.extensions.includes(extensionOf(input.filename))) {
    return { ok: false, reason: "extension_mismatch" };
  }
  if (input.declaredBytes <= 0) return { ok: false, reason: "empty_file" };
  if (input.declaredBytes > type.maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, type };
}

function matchesMagic(bytes: Uint8Array, signatures: readonly MagicSignature[]): boolean {
  return signatures.some(
    (signature) =>
      bytes.length >= signature.offset + signature.bytes.length &&
      signature.bytes.every((expected, index) => bytes[signature.offset + index] === expected),
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
  if (type.magic.length === 0 && !type.binary && !isValidUtf8(input.bytes)) {
    return { ok: false, reason: "not_valid_text" };
  }
  return { ok: true, type };
}

/**
 * Post-quarantine interpretation status (Intake Studio PRD §5.2).
 * `stored_uninterpreted` is an honest first-class outcome — a file that
 * cannot be (or fails to be) auto-interpreted is never silently skipped
 * and never given a fake interpretation.
 */
export const INTERPRETATION_STATUSES = [
  "not_interpreted",
  "interpreted",
  "stored_uninterpreted",
] as const;
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number];

/** Interpretation class for an already-validated source, from its MIME type. */
export function interpretationClassFor(
  mimeType: string | null,
  filename?: string | null,
): InterpretationClass {
  if (!mimeType) return "stored_only";
  return getAllowedType(mimeType, filename ?? undefined)?.interpretation ?? "stored_only";
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
