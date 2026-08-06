import "server-only";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Pool } from "pg";
import {
  createOpaqueSessionToken,
  openOpaqueSessionToken,
} from "@/lib/shared/auth/auth-core";
import { createSupabaseMfaAuth } from "@/lib/shared/auth/supabase-mfa";
import {
  createSupabasePasswordAuth,
  type AuthenticationResult,
} from "@/lib/shared/auth/supabase-password";
import { ServerSessionService } from "@/lib/shared/auth/server-session";
import { getEnv } from "@/lib/env";
import { LexPgAuthSessionRepository } from "./lex-session-repository";

export const LEX_SESSION_COOKIE = "lex_session";

export function createLexAuthServices(pool: Pool) {
  const env = getEnv();
  const repository = new LexPgAuthSessionRepository(pool);
  return {
    repository,
    passwordAuth: createSupabasePasswordAuth({
      url: env.LEX_SUPABASE_URL!,
      anonKey: env.LEX_SUPABASE_ANON_KEY!,
    }),
    mfaAuth: createSupabaseMfaAuth({
      url: env.LEX_SUPABASE_URL!,
      anonKey: env.LEX_SUPABASE_ANON_KEY!,
    }),
    sessions: new ServerSessionService(
      repository,
      env.LEX_AUTH_SESSION_ENCRYPTION_KEY!,
    ),
  };
}

async function provenanceHashes() {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = headerStore.get("user-agent") ?? "unknown";
  return {
    ipHash: createHash("sha256").update(ip).digest("hex").slice(0, 32),
    userAgentHash: createHash("sha256").update(userAgent).digest("hex").slice(0, 32),
  };
}

export async function establishLexSession(
  pool: Pool,
  authentication: Extract<AuthenticationResult, { ok: true }>,
): Promise<
  | { ok: true; role: string }
  | { ok: false; error: "not_invited" }
> {
  const env = getEnv();
  const services = createLexAuthServices(pool);
  const invited = await services.repository.findInvitedIdentity(
    authentication.identity.id,
  );
  if (!invited) return { ok: false, error: "not_invited" };
  await services.repository.ensureIdentityLink({
    appUserId: invited.appUserId,
    authUserId: authentication.identity.id,
    email: authentication.identity.email,
  });
  const provenance = await provenanceHashes();
  const session = await services.sessions.create({
    appUserId: invited.appUserId,
    authUserId: authentication.identity.id,
    accessToken: authentication.tokens.accessToken,
    refreshToken: authentication.tokens.refreshToken,
    accessExpiresAt: authentication.tokens.expiresAt,
    assuranceLevel: authentication.tokens.assuranceLevel,
    ...provenance,
  });
  (await cookies()).set(
    LEX_SESSION_COOKIE,
    createOpaqueSessionToken({
      sessionId: session.id,
      brand: "lex",
      secret: env.LEX_SESSION_SECRET!,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      priority: "high",
    },
  );
  return { ok: true, role: invited.role };
}

export async function getLexActiveProviderSession(pool: Pool) {
  const env = getEnv();
  const sessionId = openOpaqueSessionToken({
    token: (await cookies()).get(LEX_SESSION_COOKIE)?.value,
    brand: "lex",
    secret: env.LEX_SESSION_SECRET!,
  });
  if (!sessionId) return null;
  const services = createLexAuthServices(pool);
  let session = await services.sessions.resolve(sessionId);
  if (!session) return null;
  if (new Date(session.accessExpiresAt).getTime() <= Date.now() + 60_000) {
    const refreshed = await services.passwordAuth.refresh(session.refreshToken);
    if (!refreshed.ok) {
      await services.sessions.revoke(sessionId);
      return null;
    }
    await services.sessions.updateTokens(sessionId, {
      accessToken: refreshed.tokens.accessToken,
      refreshToken: refreshed.tokens.refreshToken,
      accessExpiresAt: refreshed.tokens.expiresAt,
      assuranceLevel: refreshed.tokens.assuranceLevel,
    });
    session = {
      ...session,
      accessToken: refreshed.tokens.accessToken,
      refreshToken: refreshed.tokens.refreshToken,
      accessExpiresAt: refreshed.tokens.expiresAt,
      assuranceLevel: refreshed.tokens.assuranceLevel,
    };
  }
  return { ...session, sessionId };
}

export async function destroyLexSession(pool: Pool): Promise<void> {
  const session = await getLexActiveProviderSession(pool);
  if (session) await createLexAuthServices(pool).sessions.revoke(session.sessionId);
  (await cookies()).delete(LEX_SESSION_COOKIE);
}
