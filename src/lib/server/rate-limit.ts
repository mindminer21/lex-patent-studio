import "server-only";

/**
 * FR-1/§11 rate limiting: fixed-window in-memory limiter keyed by a
 * privacy-reviewed identifier (hashed IP or user id — never a raw IP).
 *
 * Local mode and a single web instance share this process-local state; the
 * production deployment note is in docs/LEDGER-wepatent.md (a multi-instance
 * deployment moves the same interface onto a shared store — the call sites
 * do not change).
 */

type WindowState = { windowStart: number; count: number };

type LimiterState = Map<string, WindowState>;

const STATE_KEY = "__wepatent_rate_limits__";

function state(): LimiterState {
  const holder = globalThis as typeof globalThis & { [STATE_KEY]?: LimiterState };
  if (!holder[STATE_KEY]) holder[STATE_KEY] = new Map();
  return holder[STATE_KEY];
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

export function checkRateLimit(params: {
  /** e.g. "signin:<ipHash>" — scope plus hashed identifier. */
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = params.now ?? Date.now();
  const limiter = state();
  const entry = limiter.get(params.key);

  if (!entry || now - entry.windowStart >= params.windowMs) {
    limiter.set(params.key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: params.limit - 1 };
  }
  if (entry.count >= params.limit) {
    return { allowed: false, retryAfterMs: entry.windowStart + params.windowMs - now };
  }
  entry.count += 1;
  return { allowed: true, remaining: params.limit - entry.count };
}

/** Test hook. */
export function resetRateLimits(): void {
  const holder = globalThis as typeof globalThis & { [STATE_KEY]?: LimiterState };
  holder[STATE_KEY] = new Map();
}

/**
 * Auth endpoints (FR-1), two layers:
 * - per hashed IP + email: brute-force protection on a single account;
 * - per hashed IP: a broader spray cap that still admits shared-NAT teams.
 */
export const SIGN_IN_EMAIL_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };
export const SIGN_IN_IP_LIMIT = { limit: 100, windowMs: 5 * 60 * 1000 };
