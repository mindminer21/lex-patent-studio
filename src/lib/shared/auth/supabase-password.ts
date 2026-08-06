import { createClient } from "@supabase/supabase-js";
import { passwordCredentialsSchema } from "./auth-core";

type AuthUser = { id: string; email?: string | null };
export type SupabaseSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: AuthUser;
};
type AuthError = { message: string } | null;

export interface PasswordAuthClient {
  signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<{
    data: { user: AuthUser | null; session: SupabaseSessionPayload | null };
    error: AuthError;
  }>;
  signUp(input: {
    email: string;
    password: string;
    options: { emailRedirectTo: string; data: { display_name: string } };
  }): Promise<{ data: { user: unknown }; error: AuthError }>;
  resetPasswordForEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<{ data: unknown; error: AuthError }>;
  verifyOtp(input: {
    token_hash: string;
    type: "email" | "recovery" | "invite";
  }): Promise<{
    data: { user: AuthUser | null; session: SupabaseSessionPayload | null };
    error: AuthError;
  }>;
  refreshSession(input: { refresh_token: string }): Promise<{
    data: { user: AuthUser | null; session: SupabaseSessionPayload | null };
    error: AuthError;
  }>;
  setSession(input: { access_token: string; refresh_token: string }): Promise<{
    data: unknown;
    error: AuthError;
  }>;
  updateUser(input: { password: string }): Promise<{ data: unknown; error: AuthError }>;
}

export type AuthenticatedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  assuranceLevel: "aal1" | "aal2";
};

export type AuthenticatedIdentity = { id: string; email: string };

export type AuthenticationResult =
  | { ok: true; identity: AuthenticatedIdentity; tokens: AuthenticatedTokens }
  | { ok: false; error: "invalid_credentials" | "verification_failed" };

function mapSession(
  user: AuthUser | null,
  session: SupabaseSessionPayload | null,
): AuthenticationResult | null {
  const identity = user ?? session?.user;
  if (!identity?.id || !identity.email || !session) return null;
  const tokens = mapSupabaseSessionTokens(session);
  if (!tokens) return null;
  return {
    ok: true,
    identity: { id: identity.id, email: identity.email.toLowerCase() },
    tokens,
  };
}

export function mapSupabaseSessionTokens(
  session: SupabaseSessionPayload | null,
): AuthenticatedTokens | null {
  if (!session?.access_token || !session.refresh_token) return null;
  const expiresAtSeconds =
    session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  let assuranceLevel: "aal1" | "aal2" = "aal1";
  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { aal?: unknown };
    if (payload.aal === "aal2") assuranceLevel = "aal2";
  } catch {
    // The provider session remains authoritative; a missing/legacy claim is
    // conservatively treated as aal1 and can never bypass an MFA gate.
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    assuranceLevel,
  };
}

export class SupabasePasswordAuth {
  constructor(private readonly client: PasswordAuthClient) {}

  async signIn(input: { email: string; password: string }): Promise<AuthenticationResult> {
    const parsed = passwordCredentialsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid_credentials" };
    const { data, error } = await this.client.signInWithPassword(parsed.data);
    if (error) return { ok: false, error: "invalid_credentials" };
    return mapSession(data.user, data.session) ?? {
      ok: false,
      error: "invalid_credentials",
    };
  }

  async signUp(input: {
    email: string;
    password: string;
    displayName: string;
    emailRedirectTo: string;
  }): Promise<
    | { ok: true; confirmationRequired: true }
    | { ok: false; error: "request_failed" }
  > {
    const credentials = passwordCredentialsSchema.safeParse(input);
    if (!credentials.success) return { ok: false, error: "request_failed" };
    const { error } = await this.client.signUp({
      ...credentials.data,
      options: {
        emailRedirectTo: input.emailRedirectTo,
        data: { display_name: input.displayName.trim().slice(0, 120) },
      },
    });
    return error
      ? { ok: false, error: "request_failed" }
      : { ok: true, confirmationRequired: true };
  }

  async requestRecovery(input: {
    email: string;
    redirectTo: string;
  }): Promise<{ ok: true }> {
    const email = input.email.trim().toLowerCase();
    if (passwordCredentialsSchema.shape.email.safeParse(email).success) {
      // Always return the same external result so this endpoint cannot be
      // used to enumerate accounts.
      await this.client.resetPasswordForEmail(email, { redirectTo: input.redirectTo });
    }
    return { ok: true };
  }

  async verifyOtp(input: {
    tokenHash: string;
    type: "email" | "recovery" | "invite";
  }): Promise<AuthenticationResult> {
    const { data, error } = await this.client.verifyOtp({
      token_hash: input.tokenHash,
      type: input.type,
    });
    if (error) return { ok: false, error: "verification_failed" };
    return mapSession(data.user, data.session) ?? {
      ok: false,
      error: "verification_failed",
    };
  }

  async refresh(refreshToken: string): Promise<AuthenticationResult> {
    const { data, error } = await this.client.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) return { ok: false, error: "verification_failed" };
    return mapSession(data.user, data.session) ?? {
      ok: false,
      error: "verification_failed",
    };
  }

  async updatePassword(input: {
    accessToken: string;
    refreshToken: string;
    password: string;
  }): Promise<{ ok: true } | { ok: false; error: "request_failed" }> {
    const password = passwordCredentialsSchema.shape.password.safeParse(input.password);
    if (!password.success) return { ok: false, error: "request_failed" };
    const restored = await this.client.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });
    if (restored.error) return { ok: false, error: "request_failed" };
    const updated = await this.client.updateUser({ password: password.data });
    return updated.error
      ? { ok: false, error: "request_failed" }
      : { ok: true };
  }
}

export function createSupabasePasswordAuth(input: {
  url: string;
  anonKey: string;
}): SupabasePasswordAuth {
  const client = createClient(input.url, input.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabasePasswordAuth(client.auth);
}
