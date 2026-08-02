import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits, SIGN_IN_LIMIT } from "@/lib/server/rate-limit";

/** FR-1/§11: auth-endpoint rate limiting. */

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit inside a window, then refuses with retry-after", () => {
    const base = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = checkRateLimit({ key: "signin:hash1", limit: 5, windowMs: 60_000, now: base + attempt });
      expect(result.allowed).toBe(true);
    }
    const refused = checkRateLimit({ key: "signin:hash1", limit: 5, windowMs: 60_000, now: base + 10 });
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("resets after the window elapses", () => {
    const base = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      checkRateLimit({ key: "k", limit: 5, windowMs: 60_000, now: base });
    }
    expect(checkRateLimit({ key: "k", limit: 5, windowMs: 60_000, now: base + 1 }).allowed).toBe(false);
    expect(checkRateLimit({ key: "k", limit: 5, windowMs: 60_000, now: base + 60_000 }).allowed).toBe(true);
  });

  it("isolates keys: one hashed IP cannot exhaust another's budget", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      checkRateLimit({ key: "signin:attacker", limit: 5, windowMs: 60_000, now: 1 });
    }
    expect(checkRateLimit({ key: "signin:attacker", limit: 5, windowMs: 60_000, now: 2 }).allowed).toBe(false);
    expect(checkRateLimit({ key: "signin:victim", limit: 5, windowMs: 60_000, now: 2 }).allowed).toBe(true);
  });

  it("sign-in policy is bounded and sane", () => {
    expect(SIGN_IN_LIMIT.limit).toBeGreaterThan(0);
    expect(SIGN_IN_LIMIT.limit).toBeLessThanOrEqual(50);
    expect(SIGN_IN_LIMIT.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});
