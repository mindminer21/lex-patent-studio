import { createClient } from "@supabase/supabase-js";
import {
  mapSupabaseSessionTokens,
  type AuthenticatedTokens,
  type SupabaseSessionPayload,
} from "./supabase-password";

type AuthError = { message: string } | null;
type Factor = { id: string; status?: string };

export interface MfaAuthClient {
  setSession(input: { access_token: string; refresh_token: string }): Promise<{
    data: unknown;
    error: AuthError;
  }>;
  listFactors(): Promise<{
    data: { totp: Factor[]; all?: Factor[] } | null;
    error: AuthError;
  }>;
  getAuthenticatorAssuranceLevel(): Promise<{
    data: { currentLevel: string | null; nextLevel: string | null } | null;
    error: AuthError;
  }>;
  enroll(input: { factorType: "totp"; friendlyName: string }): Promise<{
    data: { id: string; totp?: { qr_code: string; secret: string } } | null;
    error: AuthError;
  }>;
  challenge(input: { factorId: string }): Promise<{
    data: { id: string } | null;
    error: AuthError;
  }>;
  verify(input: { factorId: string; challengeId: string; code: string }): Promise<{
    data: SupabaseSessionPayload | null;
    error: AuthError;
  }>;
}

type ProviderSession = { accessToken: string; refreshToken: string };

export class SupabaseMfaAuth {
  constructor(private readonly client: MfaAuthClient) {}

  private async restore(session: ProviderSession): Promise<boolean> {
    const restored = await this.client.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
    return !restored.error;
  }

  async status(session: ProviderSession): Promise<
    | {
        ok: true;
        currentLevel: "aal1" | "aal2";
        nextLevel: "aal1" | "aal2";
        verifiedFactorId: string | null;
      }
    | { ok: false; error: "verification_failed" }
  > {
    if (!(await this.restore(session))) return { ok: false, error: "verification_failed" };
    const [levels, factors] = await Promise.all([
      this.client.getAuthenticatorAssuranceLevel(),
      this.client.listFactors(),
    ]);
    if (levels.error || factors.error || !levels.data || !factors.data) {
      return { ok: false, error: "verification_failed" };
    }
    return {
      ok: true,
      currentLevel: levels.data.currentLevel === "aal2" ? "aal2" : "aal1",
      nextLevel: levels.data.nextLevel === "aal2" ? "aal2" : "aal1",
      verifiedFactorId: factors.data.totp[0]?.id ?? null,
    };
  }

  async enroll(session: ProviderSession): Promise<
    | { ok: true; factorId: string; qrCode: string; secret: string }
    | { ok: false; error: "request_failed" }
  > {
    if (!(await this.restore(session))) return { ok: false, error: "request_failed" };
    const { data, error } = await this.client.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    if (error || !data?.id || !data.totp?.qr_code || !data.totp.secret) {
      return { ok: false, error: "request_failed" };
    }
    const qrCode = data.totp.qr_code.startsWith("data:")
      ? data.totp.qr_code
      : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
    return {
      ok: true,
      factorId: data.id,
      qrCode,
      secret: data.totp.secret,
    };
  }

  async verify(input: ProviderSession & { factorId: string; code: string }): Promise<
    | { ok: true; tokens: AuthenticatedTokens }
    | { ok: false; error: "verification_failed" }
  > {
    if (!(await this.restore(input))) return { ok: false, error: "verification_failed" };
    const challenge = await this.client.challenge({ factorId: input.factorId });
    if (challenge.error || !challenge.data?.id) {
      return { ok: false, error: "verification_failed" };
    }
    const verified = await this.client.verify({
      factorId: input.factorId,
      challengeId: challenge.data.id,
      code: input.code.trim(),
    });
    if (verified.error) return { ok: false, error: "verification_failed" };
    const tokens = mapSupabaseSessionTokens(verified.data);
    if (!tokens || tokens.assuranceLevel !== "aal2") {
      return { ok: false, error: "verification_failed" };
    }
    return { ok: true, tokens };
  }
}

export function createSupabaseMfaAuth(input: {
  url: string;
  anonKey: string;
}): SupabaseMfaAuth {
  const client = createClient(input.url, input.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseMfaAuth({
    setSession: (session) => client.auth.setSession(session),
    listFactors: () => client.auth.mfa.listFactors(),
    getAuthenticatorAssuranceLevel: () =>
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
    enroll: (params) => client.auth.mfa.enroll(params),
    challenge: (params) => client.auth.mfa.challenge(params),
    verify: (params) => client.auth.mfa.verify(params),
  });
}
