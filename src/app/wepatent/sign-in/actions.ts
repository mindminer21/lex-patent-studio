"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdapters } from "@/lib/server/adapters";
import { createSession, destroySession } from "@/lib/server/session";

const emailSchema = z.email();

/**
 * Local-mode sign-in: creates or finds a synthetic user and sets the signed
 * session cookie. TODO(production, approval-gated per PRD §17): replace with
 * Supabase Auth (email verification, password reset, optional MFA — FR-1).
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

  await createSession(user.id);
  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/wepatent");
}
