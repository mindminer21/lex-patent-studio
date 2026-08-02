import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { needsReacceptance } from "@/lib/domain/clickwrap";
import { env } from "@/lib/env";
import { getAdapters } from "./adapters";
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
  const store = await cookies();
  store.set(SESSION_COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_MODE === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  return verify(store.get(SESSION_COOKIE)?.value);
}

export type SessionContext = {
  user: UserRecord;
  membership: MembershipRecord | null;
  organization: OrganizationRecord | null;
};

export async function getSessionContext(): Promise<SessionContext | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const { data } = getAdapters();
  const user = await data.getUserById(userId);
  if (!user) return null;
  const memberships = await data.getMembershipsForUser(user.id);
  const membership = memberships[0] ?? null;
  const organization = membership
    ? await data.getOrganizationById(membership.organizationId)
    : null;
  return { user, membership, organization };
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
  if (!context.membership || !context.organization) redirect("/app");
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
    redirect("/app/terms");
  }
  return { ...context, acceptance };
}

export type CounselContext = {
  user: UserRecord;
  assignment: CounselAssignmentRecord;
};

/**
 * Connected-counsel administration lane (PRD §6.3): a separate role surface
 * with its own audit policy. Counsel roles are NEVER granted through
 * organization membership or invitations — only through the counsel
 * assignment table written by trusted operator process.
 */
export async function getCounselContext(): Promise<CounselContext | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const { data } = getAdapters();
  const user = await data.getUserById(userId);
  if (!user) return null;
  const assignment = await data.getCounselAssignment(user.id);
  if (!assignment) return null;
  return { user, assignment };
}

/** Redirects non-counsel sessions away from /counsel/** routes. */
export async function requireCounsel(): Promise<CounselContext> {
  const context = await getCounselContext();
  if (!context) redirect("/wepatent/sign-in?error=counsel_only");
  // FR-1: MFA is required for counsel administrators. Local mode has no
  // real factor enrollment (synthetic seeds are pre-enrolled); production
  // refuses counsel sessions until Supabase Auth MFA enrollment is
  // mirrored onto the assignment by trusted operator process.
  if (env.APP_MODE === "production" && !context.assignment.mfaEnrolled) {
    redirect("/wepatent/sign-in?error=mfa_required");
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
