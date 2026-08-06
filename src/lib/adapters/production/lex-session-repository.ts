import "server-only";

import type { Pool } from "pg";
import type { Role } from "@/lib/domain/roles";
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
    accessExpiresAt: new Date(String(row.access_expires_at)).toISOString(),
    assuranceLevel: row.aal === "aal2" ? "aal2" : "aal1",
    ipHash: row.ip_hash ? String(row.ip_hash) : null,
    userAgentHash: row.user_agent_hash ? String(row.user_agent_hash) : null,
  };
}

export class LexPgAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly pool: Pool) {}

  async findInvitedIdentity(authUserId: string): Promise<{
    appUserId: string;
    displayName: string;
    role: Role;
  } | null> {
    const { rows } = await this.pool.query(
      `select p.user_id, p.display_name, m.role
         from users_profile p
         join organization_memberships m on m.user_id = p.user_id
        where p.user_id = $1
        order by m.created_at
        limit 1`,
      [authUserId],
    );
    if (!rows[0]) return null;
    return {
      appUserId: String(rows[0].user_id),
      displayName: String(rows[0].display_name),
      role: rows[0].role as Role,
    };
  }

  async ensureIdentityLink(input: {
    appUserId: string;
    authUserId: string;
    email: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into auth_identity_links
         (app_user_id, auth_user_id, email, link_method)
       values ($1, $2, lower($3), 'existing_identity')
       on conflict (app_user_id) do update
         set email = excluded.email`,
      [input.appUserId, input.authUserId, input.email],
    );
  }

  async create(input: NewStoredAuthSession): Promise<StoredAuthSession> {
    const { rows } = await this.pool.query(
      `insert into auth_sessions
         (app_user_id, auth_user_id, access_token, refresh_token,
          access_expires_at, aal, ip_hash, user_agent_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        input.appUserId,
        input.authUserId,
        input.accessToken,
        input.refreshToken,
        input.accessExpiresAt,
        input.assuranceLevel,
        input.ipHash,
        input.userAgentHash,
      ],
    );
    if (!rows[0]) throw new Error("lex_auth_session_create_failed");
    return mapSession(rows[0]);
  }

  async findActive(id: string): Promise<StoredAuthSession | null> {
    const { rows } = await this.pool.query(
      `select * from auth_sessions where id = $1 and revoked_at is null limit 1`,
      [id],
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async updateTokens(
    id: string,
    input: Pick<
      StoredAuthSession,
      "accessToken" | "refreshToken" | "accessExpiresAt" | "assuranceLevel"
    >,
  ): Promise<void> {
    await this.pool.query(
      `update auth_sessions
          set access_token = $2, refresh_token = $3, access_expires_at = $4,
              aal = $5, last_seen_at = now()
        where id = $1 and revoked_at is null`,
      [
        id,
        input.accessToken,
        input.refreshToken,
        input.accessExpiresAt,
        input.assuranceLevel,
      ],
    );
  }

  async revoke(id: string): Promise<void> {
    await this.pool.query(
      `update auth_sessions set revoked_at = now() where id = $1 and revoked_at is null`,
      [id],
    );
  }
}
