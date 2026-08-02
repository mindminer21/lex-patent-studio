import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/wepatent/env";
import type { Id } from "../adapters/types";

/**
 * Short-lived, tenant-scoped download tokens for export artifacts
 * (PRD §7.5: "Download URLs are short-lived and tenant-scoped").
 * The download route additionally requires an authenticated session in the
 * same organization — the token narrows, it never widens.
 */
const DOWNLOAD_TTL_MS = 10 * 60 * 1000;

type DownloadClaims = {
  organizationId: Id;
  exportId: Id;
  name: string;
  expiresAt: number;
};

export function mintDownloadToken(claims: Omit<DownloadClaims, "expiresAt">): string {
  const payload: DownloadClaims = { ...claims, expiresAt: Date.now() + DOWNLOAD_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", env.SESSION_SECRET).update(`dl:${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyDownloadToken(token: string): DownloadClaims | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(`dl:${body}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as DownloadClaims;
    if (typeof claims.expiresAt !== "number" || Date.now() > claims.expiresAt) return null;
    return claims;
  } catch {
    return null;
  }
}
