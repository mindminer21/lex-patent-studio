import { describe, expect, it, vi } from "vitest";
import { SupabasePasswordAuth, type PasswordAuthClient } from "./supabase-password";

function client(overrides: Partial<PasswordAuthClient> = {}): PasswordAuthClient {
  return {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn(),
    refreshSession: vi.fn(),
    setSession: vi.fn(),
    updateUser: vi.fn(),
    ...overrides,
  };
}

describe("shared Supabase password authentication", () => {
  it("maps a successful password sign-in to the server-session contract", async () => {
    const auth = new SupabasePasswordAuth(
      client({
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-1", email: "inventor@example.com" },
            session: {
              access_token: "access",
              refresh_token: "refresh",
              expires_at: 2_000_000_000,
              user: { id: "user-1", email: "inventor@example.com" },
            },
          },
          error: null,
        }),
      }),
    );

    await expect(
      auth.signIn({
        email: "inventor@example.com",
        password: "a-real-passphrase-2026",
      }),
    ).resolves.toEqual({
      ok: true,
      identity: { id: "user-1", email: "inventor@example.com" },
      tokens: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2033-05-18T03:33:20.000Z",
        assuranceLevel: "aal1",
      },
    });
  });

  it("fails closed when a stored refresh token is no longer valid", async () => {
    const auth = new SupabasePasswordAuth(
      client({
        refreshSession: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "refresh token revoked" },
        }),
      }),
    );
    await expect(auth.refresh("revoked-refresh-token")).resolves.toEqual({
      ok: false,
      error: "verification_failed",
    });
  });

  it("updates a password only after restoring the verified server session", async () => {
    const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    const auth = new SupabasePasswordAuth(client({ setSession, updateUser }));
    await expect(
      auth.updatePassword({
        accessToken: "access",
        refreshToken: "refresh",
        password: "a-new-passphrase-2026",
      }),
    ).resolves.toEqual({ ok: true });
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-passphrase-2026" });
  });

  it("returns one generic credential error without leaking provider detail", async () => {
    const auth = new SupabasePasswordAuth(
      client({
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "User not found for exact confidential address" },
        }),
      }),
    );
    await expect(
      auth.signIn({
        email: "inventor@example.com",
        password: "a-real-passphrase-2026",
      }),
    ).resolves.toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("requests verification and recovery without exposing account existence", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
    const recover = vi.fn().mockResolvedValue({ data: {}, error: null });
    const auth = new SupabasePasswordAuth(
      client({ signUp, resetPasswordForEmail: recover }),
    );

    await expect(
      auth.signUp({
        email: "inventor@example.com",
        password: "a-real-passphrase-2026",
        displayName: "Inventor",
        emailRedirectTo: "https://example.com/wepatent/auth/confirm",
      }),
    ).resolves.toEqual({ ok: true, confirmationRequired: true });
    await expect(
      auth.requestRecovery({
        email: "inventor@example.com",
        redirectTo: "https://example.com/wepatent/auth/confirm",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
