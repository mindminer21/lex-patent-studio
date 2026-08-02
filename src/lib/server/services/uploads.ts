import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  validateUploadBytes,
  validateUploadRequest,
  type UploadRejection,
} from "@/lib/domain/uploads";
import { env } from "@/lib/env";
import { getAdapters } from "../adapters";
import { enqueueJob } from "../jobs/runner";
import { storagePathFor, transitionSource } from "./upload-pipeline";
import type { Id, SourceRecord } from "../adapters/types";

/**
 * Signed-upload contract (FR-4):
 *
 * 1. POST /api/inventions/:id/uploads/sign validates name/type/size against
 *    the allowlist and returns a short-lived, tenant-scoped upload token.
 * 2. PUT /api/uploads/:token receives the bytes, re-validates (size cap,
 *    magic bytes), stores them in private storage, moves the source through
 *    uploaded → quarantined, and enqueues the scan job.
 * 3. The scan job releases to `scanned` (then extraction) or `rejected`.
 *
 * The token is HMAC-signed and expires; it authorizes exactly one source id
 * for one organization — it is not a bearer credential for anything else.
 */
const TOKEN_TTL_MS = 10 * 60 * 1000;

export const signUploadSchema = z.object({
  filename: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(3).max(200),
  declaredBytes: z.number().int().positive(),
  kind: z.string().trim().min(1).max(60),
  note: z.string().trim().max(1000).default(""),
});

type TokenPayload = {
  sourceId: Id;
  organizationId: Id;
  expiresAt: number;
};

function signToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyUploadToken(token: string): TokenPayload | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) return null;
    if (!payload.sourceId || !payload.organizationId) return null;
    return payload;
  } catch {
    return null;
  }
}

export type SignUploadResult =
  | { ok: true; sourceId: Id; token: string; expiresAt: string }
  | { ok: false; error: "invalid_input" | "invention_not_found" | UploadRejection };

export async function signUpload(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  input: unknown;
}): Promise<SignUploadResult> {
  const parsed = signUploadSchema.safeParse(params.input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };

  const validation = validateUploadRequest({
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    declaredBytes: parsed.data.declaredBytes,
  });
  if (!validation.ok) return { ok: false, error: validation.reason };

  const source = await data.createSource({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    name: parsed.data.filename,
    kind: parsed.data.kind,
    note: parsed.data.note,
    status: "registered",
    synthetic: false,
    originalFilename: parsed.data.filename,
    mimeType: parsed.data.mimeType.toLowerCase(),
    byteSize: null,
    storagePath: null,
    checksumSha256: null,
    quarantineReason: null,
  });
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = signToken({
    sourceId: source.id,
    organizationId: params.organizationId,
    expiresAt,
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "source.upload_signed",
    target: source.id,
    meta: { mimeType: parsed.data.mimeType.toLowerCase() },
  });
  return { ok: true, sourceId: source.id, token, expiresAt: new Date(expiresAt).toISOString() };
}

export type AcceptUploadResult =
  | { ok: true; source: SourceRecord }
  | {
      ok: false;
      error: "invalid_token" | "source_not_found" | "already_uploaded" | UploadRejection;
    };

export async function acceptUpload(params: {
  token: string;
  bytes: Uint8Array;
}): Promise<AcceptUploadResult> {
  const payload = verifyUploadToken(params.token);
  if (!payload) return { ok: false, error: "invalid_token" };

  const { data, storage } = getAdapters();
  const source = await data.getSource(payload.organizationId, payload.sourceId);
  if (!source) return { ok: false, error: "source_not_found" };
  if (source.status !== "registered") return { ok: false, error: "already_uploaded" };

  const validation = validateUploadBytes({
    filename: source.originalFilename ?? source.name,
    mimeType: source.mimeType ?? "",
    bytes: params.bytes,
  });
  if (!validation.ok) {
    await data.updateSource(payload.organizationId, payload.sourceId, {
      status: "rejected",
      quarantineReason: `upload_validation_failed:${validation.reason}`,
    });
    await data.appendAuditEvent({
      organizationId: payload.organizationId,
      actor: "system",
      action: "source.upload_rejected",
      target: payload.sourceId,
      meta: { reason: validation.reason },
    });
    return { ok: false, error: validation.reason };
  }

  const path = storagePathFor(payload.organizationId, payload.sourceId);
  await storage.put(path, params.bytes);
  const checksum = createHash("sha256").update(params.bytes).digest("hex");
  await data.updateSource(payload.organizationId, payload.sourceId, {
    byteSize: params.bytes.length,
    storagePath: path,
    checksumSha256: checksum,
  });
  // Bytes received → uploaded → quarantined (never directly usable).
  await transitionSource(payload.organizationId, payload.sourceId, "uploaded");
  const quarantined = await transitionSource(
    payload.organizationId,
    payload.sourceId,
    "quarantined",
  );
  await enqueueJob({
    organizationId: payload.organizationId,
    kind: "source_scan",
    idempotencyKey: `scan:${payload.sourceId}`,
    payload: { sourceId: payload.sourceId },
  });
  await data.appendAuditEvent({
    organizationId: payload.organizationId,
    actor: "system",
    action: "source.quarantined",
    target: payload.sourceId,
    meta: { byteSize: params.bytes.length },
  });
  return { ok: true, source: quarantined! };
}
