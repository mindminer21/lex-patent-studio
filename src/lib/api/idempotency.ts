import { createHash } from "node:crypto";
import { getLocalStore } from "@/lib/adapters/local";
import { apiResult, badRequest, type ApiResult } from "./http";

/**
 * Idempotency keys for money/job endpoints (PRD §12 conventions).
 *
 * A replay with the same key + identical request returns the ORIGINAL
 * response without re-executing (no double charge, no duplicate job). The
 * same key with a DIFFERENT request body is a 409 conflict.
 *
 * Production persists idempotency records in Postgres (usage_reservations
 * and wallet_ledger_entries carry unique idempotency keys in the schema);
 * this in-memory record store is the local-mode equivalent seam
 * with a TTL; local mode stores them in the in-memory store.
 */

export function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export async function withIdempotency(
  request: Request,
  endpoint: string,
  requestBody: unknown,
  compute: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) {
    return badRequest(
      "Idempotency-Key header is required on this endpoint.",
    );
  }
  if (key.length > 200) return badRequest("Idempotency-Key is too long.");

  const store = getLocalStore();
  const requestHash = hashRequest(requestBody);
  const existing = store.idempotency.find(
    (r) => r.key === key && r.endpoint === endpoint,
  );
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return apiResult(409, {
        error:
          "Idempotency-Key was already used with a different request body.",
      });
    }
    return apiResult(existing.status, existing.body);
  }

  const result = await compute();
  // Replay protection covers success AND deterministic refusals; 5xx are
  // not recorded so a transient failure can be retried with the same key.
  if (result.status < 500) {
    store.idempotency.push({
      key,
      endpoint,
      requestHash,
      status: result.status,
      body: result.body,
      createdAt: new Date().toISOString(),
    });
  }
  return result;
}
