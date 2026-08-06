import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthSessionRepository,
  NewStoredAuthSession,
  StoredAuthSession,
} from "@/lib/shared/auth/server-session";

type Row = Record<string, unknown>;

function mapSession(row: Row): StoredAuthSession {
  return {
    id: String(row.id),
    appUserId: String(row.app_user_id),
    authUserId: String(row.auth_user_id),
    accessToken: String(row.access_token),
    refreshToken: String(row.refresh_token),
    accessExpiresAt: String(row.access_expires_at),
    assuranceLevel: row.aal === "aal2" ? "aal2" : "aal1",
    ipHash: row.ip_hash ? String(row.ip_hash) : null,
    userAgentHash: row.user_agent_hash ? String(row.user_agent_hash) : null,
  };
}

function sessionInsert(input: NewStoredAuthSession) {
  return {
    app_user_id: input.appUserId,
    auth_user_id: input.authUserId,
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    access_expires_at: input.accessExpiresAt,
    aal: input.assuranceLevel,
    ip_hash: input.ipHash,
    user_agent_hash: input.userAgentHash,
  };
}

export class ConsumerSupabaseAuthRepository implements AuthSessionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async ensureIdentity(input: {
    authUserId: string;
    email: string;
    displayName: string;
    linkMethod: "self_match" | "existing_identity" | "created_identity";
  }): Promise<string> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const { error: profileError } = await this.client.from("users_profile").upsert(
      {
        id: input.authUserId,
        display_name: input.displayName.trim().slice(0, 120) || normalizedEmail.split("@")[0],
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (profileError) throw new Error("auth_identity_profile_write_failed");
    const { error: linkError } = await this.client.from("auth_identity_links").upsert(
      {
        app_user_id: input.authUserId,
        auth_user_id: input.authUserId,
        email: normalizedEmail,
        link_method: input.linkMethod,
      },
      { onConflict: "app_user_id" },
    );
    if (linkError) throw new Error("auth_identity_link_write_failed");
    return input.authUserId;
  }

  async create(input: NewStoredAuthSession): Promise<StoredAuthSession> {
    const { data, error } = await this.client
      .from("auth_sessions")
      .insert(sessionInsert(input))
      .select("*")
      .single();
    if (error || !data) throw new Error("auth_session_create_failed");
    return mapSession(data);
  }

  async findActive(id: string): Promise<StoredAuthSession | null> {
    const { data, error } = await this.client
      .from("auth_sessions")
      .select("*")
      .eq("id", id)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw new Error("auth_session_read_failed");
    return data ? mapSession(data) : null;
  }

  async updateTokens(
    id: string,
    input: Pick<
      StoredAuthSession,
      "accessToken" | "refreshToken" | "accessExpiresAt" | "assuranceLevel"
    >,
  ): Promise<void> {
    const { error } = await this.client
      .from("auth_sessions")
      .update({
        access_token: input.accessToken,
        refresh_token: input.refreshToken,
        access_expires_at: input.accessExpiresAt,
        aal: input.assuranceLevel,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("revoked_at", null);
    if (error) throw new Error("auth_session_refresh_failed");
  }

  async revoke(id: string): Promise<void> {
    const { error } = await this.client
      .from("auth_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("revoked_at", null);
    if (error) throw new Error("auth_session_revoke_failed");
  }
}

export function createConsumerSupabaseAuthRepository(input: {
  url: string;
  serviceRoleKey: string;
}): ConsumerSupabaseAuthRepository {
  const client = createClient(input.url, input.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new ConsumerSupabaseAuthRepository(client);
}
