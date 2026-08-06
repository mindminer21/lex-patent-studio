import { describe, expect, it, vi } from "vitest";
import { SupabaseMfaAuth, type MfaAuthClient } from "./supabase-mfa";

function client(overrides: Partial<MfaAuthClient> = {}): MfaAuthClient {
  return {
    setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    listFactors: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
    enroll: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
    ...overrides,
  };
}

describe("shared Supabase TOTP MFA", () => {
  it("restores the server-held provider session before enrollment", async () => {
    const enroll = vi.fn().mockResolvedValue({
      data: {
        id: "factor-1",
        totp: { qr_code: "data:image/svg+xml;base64,qr", secret: "TOTPSECRET" },
      },
      error: null,
    });
    const auth = new SupabaseMfaAuth(client({ enroll }));
    await expect(
      auth.enroll({ accessToken: "access", refreshToken: "refresh" }),
    ).resolves.toEqual({
      ok: true,
      factorId: "factor-1",
      qrCode: "data:image/svg+xml;base64,qr",
      secret: "TOTPSECRET",
    });
    expect(enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
  });

  it("challenges and verifies a TOTP code and returns aal2 tokens", async () => {
    const accessToken = [
      Buffer.from("{}").toString("base64url"),
      Buffer.from(JSON.stringify({ aal: "aal2" })).toString("base64url"),
      "signature",
    ].join(".");
    const auth = new SupabaseMfaAuth(
      client({
        challenge: vi.fn().mockResolvedValue({ data: { id: "challenge-1" }, error: null }),
        verify: vi.fn().mockResolvedValue({
          data: {
            access_token: accessToken,
            refresh_token: "new-refresh",
            expires_at: 2_000_000_000,
            user: { id: "user-1", email: "admin@example.com" },
          },
          error: null,
        }),
      }),
    );
    await expect(
      auth.verify({
        accessToken: "access",
        refreshToken: "refresh",
        factorId: "factor-1",
        code: "123456",
      }),
    ).resolves.toMatchObject({
      ok: true,
      tokens: { assuranceLevel: "aal2", refreshToken: "new-refresh" },
    });
  });
});
