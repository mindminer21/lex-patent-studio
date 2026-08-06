"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { needsReacceptance } from "@/lib/wepatent/domain/clickwrap";
import { isLocalMode } from "@/lib/wepatent/env";
import { getAdapters } from "@/lib/server/adapters";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { ensurePersonalOrganization } from "@/lib/server/services/orgs";
import { incrementCounter, logEvent } from "@/lib/server/observability";
import {
  checkRateLimit,
  SIGN_IN_EMAIL_LIMIT,
  SIGN_IN_IP_LIMIT,
} from "@/lib/server/rate-limit";
import {
  createAuthenticatedSession,
  createSession,
  destroySession,
  requestIpHash,
} from "@/lib/server/session";

const emailSchema = z.email();

/**
 * LOCAL MODE ONLY: these synthetic identities carry counsel-lane
 * assignments so the separate /counsel administration lane (PRD §6.3) can
 * be exercised without a provisioning backend. In production, counsel
 * assignments are written exclusively by trusted operator process and are
 * never derived from an email address.
 */
const LOCAL_COUNSEL_SEEDS: Record<string, "counsel_intake" | "counsel_attorney"> = {
  "counsel-intake@wepatent.local": "counsel_intake",
  "counsel-attorney@wepatent.local": "counsel_attorney",
};

/**
 * Local-mode sign-in: creates or finds a synthetic user and sets the signed
 * session cookie. Production seam (approval-gated, PRD §17.1): Supabase
 * Auth hosts sign-in with email verification, password reset, and MFA
 * (FR-1; MFA required for counsel administrators — enforced in
 * requireCounsel). The data adapter already creates identities through
 * Supabase Auth admin APIs.
 */
export async function signInAction(formData: FormData): Promise<void> {
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  // FR-1: rate limit the auth endpoint. Keys use the hashed IP (never a
  // raw IP) — a tight per-account layer plus a broader per-IP spray cap.
  const ipHash = await requestIpHash();
  const emailHash = createHash("sha256").update(rawEmail).digest("hex").slice(0, 16);
  const perEmail = checkRateLimit({
    key: `signin:${ipHash}:${emailHash}`,
    ...SIGN_IN_EMAIL_LIMIT,
  });
  const perIp = checkRateLimit({ key: `signin:${ipHash}`, ...SIGN_IN_IP_LIMIT });
  if (!perEmail.allowed || !perIp.allowed) {
    incrementCounter("auth.rate_limited");
    logEvent({ level: "warn", event: "auth.rate_limited", meta: { ipHash } });
    redirect("/wepatent/sign-in?error=rate_limited");
  }

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    redirect("/wepatent/sign-in?error=invalid_email");
  }
  const displayName =
    String(formData.get("name") ?? "").trim().slice(0, 120) || parsed.data.split("@")[0];

  const { data } = getAdapters();
  let user;
  if (isLocalMode) {
    user =
      (await data.getUserByEmail(parsed.data)) ??
      (await data.createUser({ email: parsed.data, displayName }));
    await createSession(user.id);
  } else {
    const password = String(formData.get("password") ?? "");
    const authentication = await createConsumerAuthServices().passwordAuth.signIn({
      email: parsed.data,
      password,
    });
    if (!authentication.ok) {
      redirect("/wepatent/sign-in?error=invalid_credentials");
    }
    const appUserId = await createAuthenticatedSession({
      authentication,
      displayName,
      linkMethod: "existing_identity",
    });
    user = await data.getUserById(appUserId);
    if (!user) throw new Error("Verified user profile could not be loaded.");
  }

  if (isLocalMode && LOCAL_COUNSEL_SEEDS[parsed.data]) {
    await data.setCounselAssignment({
      userId: user.id,
      role: LOCAL_COUNSEL_SEEDS[parsed.data],
      lawFirmName: "Schell IP (connected counsel, synthetic local)",
      // Local synthetic seeds are treated as MFA-enrolled so the counsel
      // lane is exercisable; production enforcement happens in
      // requireCounsel and real enrollment lives in Supabase Auth (FR-1).
      mfaEnrolled: true,
      createdAt: new Date().toISOString(),
    });
  }

  const assignment = await data.getCounselAssignment(user.id);
  if (assignment) redirect("/counsel");

  // Design rule (minimal human input): no blocking "Create your
  // organization" step. The first organization is created here with a
  // placeholder name the user can change in Settings; the call is
  // idempotent, so returning users and invited members are unaffected.
  // Everything else about tenancy is unchanged — same transactional
  // creation path, same owner membership, retention default, wallet, and
  // `organization.created` audit event.
  const organization = await ensurePersonalOrganization(user);
  if (organization) {
    const acceptance = await data.getLatestAcceptance(organization.id, user.id);
    if (!acceptance || needsReacceptance(acceptance.termsVersion)) {
      // Clickwrap stays a required, explicit step (KEEP list).
      redirect("/wepatent/app/terms");
    }
  }
  const requestedNext = String(formData.get("next") ?? "");
  redirect(requestedNext.startsWith("/wepatent/app") ? requestedNext : "/wepatent/app");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/wepatent");
}
