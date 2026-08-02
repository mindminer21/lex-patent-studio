"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocalMode } from "@/lib/env";
import { getAdapters } from "@/lib/server/adapters";
import { createSession, destroySession } from "@/lib/server/session";

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
 * session cookie. TODO(production, approval-gated per PRD §17): replace with
 * Supabase Auth (email verification, password reset, optional MFA — FR-1;
 * MFA required for counsel administrators).
 */
export async function signInAction(formData: FormData): Promise<void> {
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    redirect("/wepatent/sign-in?error=invalid_email");
  }
  const displayName =
    String(formData.get("name") ?? "").trim().slice(0, 120) || parsed.data.split("@")[0];

  const { data } = getAdapters();
  const user =
    (await data.getUserByEmail(parsed.data)) ??
    (await data.createUser({ email: parsed.data, displayName }));

  if (isLocalMode && LOCAL_COUNSEL_SEEDS[parsed.data]) {
    await data.setCounselAssignment({
      userId: user.id,
      role: LOCAL_COUNSEL_SEEDS[parsed.data],
      lawFirmName: "Schell IP (connected counsel, synthetic local)",
      createdAt: new Date().toISOString(),
    });
  }

  await createSession(user.id);
  const assignment = await data.getCounselAssignment(user.id);
  redirect(assignment ? "/counsel" : "/app");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/wepatent");
}
