import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGEMENT_KEYS,
  ACKNOWLEDGEMENTS,
  categorizeUserAgent,
  CURRENT_TERMS_VERSION,
  needsReacceptance,
  validateAcceptance,
} from "@/lib/domain/clickwrap";

describe("versioned clickwrap (PRD §7.2)", () => {
  it("defines exactly four required acknowledgements", () => {
    expect(ACKNOWLEDGEMENTS).toHaveLength(4);
    expect(new Set(ACKNOWLEDGEMENT_KEYS).size).toBe(4);
  });

  it("accepts only when all four acknowledgements are present", () => {
    expect(
      validateAcceptance({
        termsVersion: CURRENT_TERMS_VERSION,
        acknowledgedKeys: [...ACKNOWLEDGEMENT_KEYS],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects any missing acknowledgement", () => {
    for (const missingKey of ACKNOWLEDGEMENT_KEYS) {
      const keys = ACKNOWLEDGEMENT_KEYS.filter((key) => key !== missingKey);
      const result = validateAcceptance({
        termsVersion: CURRENT_TERMS_VERSION,
        acknowledgedKeys: keys,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("missing_acknowledgements");
        expect(result.missing).toEqual([missingKey]);
      }
    }
  });

  it("rejects an empty acknowledgement set", () => {
    const result = validateAcceptance({
      termsVersion: CURRENT_TERMS_VERSION,
      acknowledgedKeys: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stale terms version even with all acknowledgements", () => {
    const result = validateAcceptance({
      termsVersion: "2020-01-01.0",
      acknowledgedKeys: [...ACKNOWLEDGEMENT_KEYS],
    });
    expect(result).toEqual({ ok: false, error: "version_mismatch" });
  });

  it("requires re-acceptance when the version changes or never accepted", () => {
    expect(needsReacceptance(null)).toBe(true);
    expect(needsReacceptance(undefined)).toBe(true);
    expect(needsReacceptance("old-version")).toBe(true);
    expect(needsReacceptance(CURRENT_TERMS_VERSION)).toBe(false);
  });

  it("categorizes user agents coarsely without storing raw strings", () => {
    expect(categorizeUserAgent(null)).toBe("unknown");
    expect(categorizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS)")).toBe("mobile");
    expect(categorizeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/125")).toBe("desktop");
    expect(categorizeUserAgent("curl/8.0")).toBe("bot");
  });
});
