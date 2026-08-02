import { describe, expect, it } from "vitest";
import { legacyRedirects } from "@/lib/config/redirects";
import nextConfig from "../next.config";

describe("legacy redirect rules (PRD §6.1)", () => {
  it("permanently redirects /venture to /wepatent", () => {
    const rule = legacyRedirects.find((r) => r.source === "/venture");
    expect(rule).toBeDefined();
    expect(rule?.destination).toBe("/wepatent");
    expect(rule?.permanent).toBe(true);
  });

  it("permanently redirects /venture subpaths to /wepatent subpaths", () => {
    const rule = legacyRedirects.find((r) => r.source === "/venture/:path*");
    expect(rule?.destination).toBe("/wepatent/:path*");
    expect(rule?.permanent).toBe(true);
  });

  it("permanently redirects /self-service-terms to /wepatent/terms", () => {
    const rule = legacyRedirects.find((r) => r.source === "/self-service-terms");
    expect(rule?.destination).toBe("/wepatent/terms");
    expect(rule?.permanent).toBe(true);
  });

  it("every legacy redirect is permanent (308)", () => {
    expect(legacyRedirects.length).toBeGreaterThanOrEqual(3);
    for (const rule of legacyRedirects) {
      expect(rule.permanent).toBe(true);
    }
  });

  it("next.config wires the legacy redirects", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual(legacyRedirects);
  });

  it("next.config applies security headers to all routes", async () => {
    const headers = await nextConfig.headers?.();
    expect(headers?.[0]?.source).toBe("/:path*");
    const keys = headers?.[0]?.headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("Strict-Transport-Security");
  });
});
