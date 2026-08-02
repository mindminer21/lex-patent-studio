import { cookies } from "next/headers";
import type { Pool } from "pg";
import type { AuthAdapter, Session } from "@/lib/adapters/types";
import type { Role } from "@/lib/domain/roles";

/**
 * PRODUCTION AuthAdapter — Supabase Auth (FR-1).
 *
 * Sessions arrive as HTTP-only cookies set by the Supabase SSR flow. This
 * adapter verifies the access token against the Supabase Auth server
 * (`/auth/v1/user`) — never trusting client-supplied identity — and derives
 * organization and role from organization_memberships (PRD-wepatent
 * Invariant 6: tenant and role come from the authenticated session, never
 * from a client-supplied tenant id).
 *
 * Testable without credentials via the injected `verifyToken` seam; the
 * default implementation calls the real Supabase endpoint once
 * LEX_SUPABASE_URL/ANON_KEY exist (approval-gated, §17.1).
 */

export interface VerifiedUser {
  id: string;
  email: string;
}

export type TokenVerifier = (accessToken: string) => Promise<VerifiedUser | null>;

export function supabaseTokenVerifier(
  supabaseUrl: string,
  anonKey: string,
): TokenVerifier {
  return async (accessToken: string) => {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: string; email?: string };
    if (!user.id) return null;
    return { id: user.id, email: user.email ?? "" };
  };
}

/** Supabase SSR cookie name prefix: sb-<project-ref>-auth-token. */
export function extractAccessToken(
  cookieList: Array<{ name: string; value: string }>,
): string | null {
  const authCookie = cookieList.find(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"),
  );
  if (!authCookie) return null;
  try {
    const parsed = JSON.parse(
      authCookie.value.startsWith("base64-")
        ? Buffer.from(authCookie.value.slice(7), "base64").toString("utf8")
        : authCookie.value,
    ) as { access_token?: string } | [string];
    if (Array.isArray(parsed)) return parsed[0] ?? null;
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

export class SupabaseAuthAdapter implements AuthAdapter {
  constructor(
    private readonly pool: Pool,
    private readonly verifyToken: TokenVerifier,
  ) {}

  async getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const token = extractAccessToken(cookieStore.getAll());
    if (!token) return null;

    const user = await this.verifyToken(token);
    if (!user) return null;

    // Tenant + role from the membership table, by verified user id only.
    const { rows } = await this.pool.query(
      `select m.organization_id, m.role, o.name as organization_name,
              coalesce(p.display_name, $2) as display_name
         from organization_memberships m
         join organizations o on o.id = m.organization_id
         left join users_profile p on p.user_id = m.user_id
        where m.user_id = $1
        order by m.created_at
        limit 1`,
      [user.id, user.email],
    );
    if (!rows[0]) return null;
    return {
      userId: user.id,
      displayName: String(rows[0].display_name),
      email: user.email,
      organizationId: String(rows[0].organization_id),
      organizationName: String(rows[0].organization_name),
      role: rows[0].role as Role,
      synthetic: false,
    };
  }
}
