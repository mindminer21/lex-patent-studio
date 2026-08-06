import { describe, expect, it } from "vitest";
import {
  createOpaqueSessionToken,
  openOpaqueSessionToken,
  passwordCredentialsSchema,
  passwordSchema,
} from "./auth-core";

describe("shared authentication core", () => {
  it("validates normalized email and a launch-grade password", () => {
    const parsed = passwordCredentialsSchema.parse({
      email: "  INVENTOR@EXAMPLE.COM ",
      password: "a-real-passphrase-2026",
    });
    expect(parsed).toEqual({
      email: "inventor@example.com",
      password: "a-real-passphrase-2026",
    });
  });

  it("rejects short and excessively large password payloads", () => {
    expect(passwordSchema.safeParse("too-short").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(513)).success).toBe(false);
  });

  it("signs only an opaque session id and binds it to one brand", () => {
    const token = createOpaqueSessionToken({
      sessionId: "3a1c4c8b-9e34-41d4-9ac1-6f79fe676a31",
      brand: "consumer",
      secret: "test-secret-that-is-long-enough",
    });

    expect(token).not.toContain("inventor@example.com");
    expect(
      openOpaqueSessionToken({
        token,
        brand: "consumer",
        secret: "test-secret-that-is-long-enough",
      }),
    ).toBe("3a1c4c8b-9e34-41d4-9ac1-6f79fe676a31");
    expect(
      openOpaqueSessionToken({
        token,
        brand: "lex",
        secret: "test-secret-that-is-long-enough",
      }),
    ).toBeNull();
  });

  it("refuses a tampered opaque session token", () => {
    const token = createOpaqueSessionToken({
      sessionId: "3a1c4c8b-9e34-41d4-9ac1-6f79fe676a31",
      brand: "lex",
      secret: "test-secret-that-is-long-enough",
    });
    expect(
      openOpaqueSessionToken({
        token: `${token.slice(0, -1)}x`,
        brand: "lex",
        secret: "test-secret-that-is-long-enough",
      }),
    ).toBeNull();
  });
});
