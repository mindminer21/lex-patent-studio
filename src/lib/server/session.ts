import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOpaqueSessionToken,
  openOpaqueSessionToken,
} from "@/lib/shared/auth/auth-core";
import type { AuthenticationResult } from "@/lib/shared/auth/supabase-password";
import type {
  ActiveAuthSession,
  AssuranceLevel,
} from "@/lib/shared/auth/server-session";
import { needsReacceptance } from "@/lib/wepatent/domain/clickwrap";
import { env } from "@/lib/wepatent/env";
import { getAdapters } from "./adapters";
import { createConsumerAuthServices } from "./auth/consumer-auth";
import type {
  CounselAssignmentRecord,
  MembershipRecord,
  OrganizationRecord,
  TermsAcceptanceRecord,
  UserRecord,
} from "./adapters/types";

/**
 * Cookie session for credential-independent local mode.
 *
 * The cookie carries only an HMAC-signed user id — the server derives tenant
 * and role from the stored membership, never from client-supplied values
 * (PRD §5.6). Production seam (approval-gated, PRD §17.1): Supabase Auth
 * server-side cookie helpers replace this signer; the SupabaseDataAdapter
 * already sources identities from Supabase Auth admin APIs (FR-1).
 */
const SESSION_COOKIE = "wp_session";

function sign(userId: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const userId = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET).update(userId).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

export async function createSession(userId: string): Promise<void> {
  if (env.APP_MODE === "production") {
    throw new Error("Production sessions require verified provider credentials.");
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  if (env.APP_MODE === "production") {
    const sessionId = openOpaqueSessionToken({
      token: store.get(SESSION_COOKIE)?.value,
      brand: "consumer",
      secret: env.SESSION_SECRET,
    });
    if (sessionId) {
      await createConsumerAuthServices().sessions.revoke(sessionId);
    }
  }
  store.delete(SESSION_COOKIE);
}

type SessionIdentity = {
  appUserId: string;
  assuranceLevel: AssuranceLevel;
};

async function getProductionActiveSession(): Promise<
  (ActiveAuthSession & { sessionId: string }) | null
> {
  const store = await cookies();
  const sessionId = openOpaqueSessionToken({
    token: store.get(SESSION_COOKIE)?.value,
    brand: "consumer",
    secret: env.SESSION_SECRET,
  });
  if (!sessionId) return null;
  const services = createConsumerAuthServices();
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

export async function getAuthenticatedProviderSession(): Promise<
  (ActiveAuthSession & { sessionId: string }) | null
> {
  if (env.APP_MODE !== "production") return null;
  return getProductionActiveSession();
}

async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const store = await cookies();
  if (env.APP_MODE !== "production") {
    const userId = verify(store.get(SESSION_COOKIE)?.value);
    return userId ? { appUserId: userId, assuranceLevel: "aal2" } : null;
  }
  const session = await getProductionActiveSession();
  if (!session) return null;
  return {
    appUserId: session.appUserId,
    assuranceLevel: session.assuranceLevel,
  };
}

export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionIdentity())?.appUserId ?? null;
}

export async function createAuthenticatedSession(input: {
  authentication: Extract<AuthenticationResult, { ok: true }>;
  displayName: string;
  linkMethod: "self_match" | "existing_identity" | "created_identity";
}): Promise<string> {
  if (env.APP_MODE !== "production") {
    throw new Error("Verified provider sessions are production-only.");
  }
  const services = createConsumerAuthServices();
  const appUserId = await services.repository.ensureIdentity({
    authUserId: input.authentication.identity.id,
    email: input.authentication.identity.email,
    displayName: input.displayName,
    linkMethod: input.linkMethod,
  });
  const created = await services.sessions.create({
    appUserId,
    authUserId: input.authentication.identity.id,
    accessToken: input.authentication.tokens.accessToken,
    refreshToken: input.authentication.tokens.refreshToken,
    accessExpiresAt: input.authentication.tokens.expiresAt,
    assuranceLevel: input.authentication.tokens.assuranceLevel,
    ipHash: await requestIpHash(),
    userAgentHash: await requestUserAgentHash(),
  });
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    createOpaqueSessionToken({
      sessionId: created.id,
      brand: "consumer",
      secret: env.SESSION_SECRET,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      priority: "high",
    },
  );
  return appUserId;
}

export type SessionContext = {
  user: UserRecord;
  membership: MembershipRecord | null;
  organization: OrganizationRecord | null;
  assuranceLevel: AssuranceLevel;
};

export async function getSessionContext(): Promise<SessionContext | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const { data } = getAdapters();
  const user = await data.getUserById(identity.appUserId);
  if (!user) return null;
  const memberships = await data.getMembershipsForUser(user.id);
  const membership = memberships[0] ?? null;
  const organization = membership
    ? await data.getOrganizationById(membership.organizationId)
    : null;
  return { user, membership, organization, assuranceLevel: identity.assuranceLevel };
}

/** Redirects to sign-in when unauthenticated. */
export async function requireUser(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect("/wepatent/sign-in");
  return context;
}

export type OrgContext = {
  user: UserRecord;
  membership: MembershipRecord;
  organization: OrganizationRecord;
};

/** Redirects to the dashboard (org creation) when no organization exists. */
export async function requireOrg(): Promise<OrgContext> {
  const context = await requireUser();
  if (!context.membership || !context.organization) redirect("/wepatent/app");
  return {
    user: context.user,
    membership: context.membership,
    organization: context.organization,
  };
}

export type OnboardedContext = OrgContext & { acceptance: TermsAcceptanceRecord };

/**
 * Substantive intake, drafting, and counsel requests require a current
 * server-recorded clickwrap acceptance (PRD §7.2).
 */
export async function requireOnboarded(): Promise<OnboardedContext> {
  const context = await requireOrg();
  const { data } = getAdapters();
  const acceptance = await data.getLatestAcceptance(
    context.organization.id,
    context.user.id,
  );
  if (!acceptance || needsReacceptance(acceptance.termsVersion)) {
    redirect("/wepatent/app/terms");
  }
  return { ...context, acceptance };
}

export type CounselContext = {
  user: UserRecord;
  assignment: CounselAssignmentRecord;
  assuranceLevel: AssuranceLevel;
};

/**
 * Connected-counsel administration lane (PRD §6.3): a separate role surface
 * with its own audit policy. Counsel roles are NEVER granted through
 * organization membership or invitations — only through the counsel
 * assignment table written by trusted operator process.
 */
export async function getCounselContext(): Promise<CounselContext | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const { data } = getAdapters();
  const user = await data.getUserById(identity.appUserId);
  if (!user) return null;
  const assignment = await data.getCounselAssignment(user.id);
  if (!assignment) return null;
  return { user, assignment, assuranceLevel: identity.assuranceLevel };
}

/** Redirects non-counsel sessions away from /counsel/** routes. */
export async function requireCounsel(): Promise<CounselContext> {
  const context = await getCounselContext();
  if (!context) redirect("/wepatent/sign-in?error=counsel_only");
  // FR-1: MFA is required for counsel administrators. Local mode has no
  // real factor enrollment (synthetic seeds are pre-enrolled); production
  // refuses counsel sessions until Supabase Auth MFA enrollment is
  // mirrored onto the assignment by trusted operator process.
  if (env.APP_MODE === "production" && context.assuranceLevel !== "aal2") {
    redirect("/wepatent/mfa?next=/counsel");
  }
  return context;
}

/** Privacy-preserving IP hash for the clickwrap audit record. */
export async function requestIpHash(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${env.IP_HASH_SALT}:${ip}`).digest("hex").slice(0, 32);
}

export async function requestUserAgent(): Promise<string | null> {
  const headerStore = await headers();
  return headerStore.get("user-agent");
}

export async function requestUserAgentHash(): Promise<string | null> {
  const userAgent = await requestUserAgent();
  if (!userAgent) return null;
  return createHash("sha256").update(userAgent).digest("hex").slice(0, 32);
}
