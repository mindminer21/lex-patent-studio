"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import {
  createLexAuthServices,
  destroyLexSession,
  establishLexSession,
} from "@/lib/adapters/production/lex-auth-session";
import { getPool } from "@/lib/adapters/production/db";

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  return next === "/app" || next.startsWith("/app/") ? next : "/app";
}

export async function lexSignInAction(formData: FormData): Promise<void> {
  const env = getEnv();
  if (env.LEX_APP_MODE !== "production") redirect("/app");
  const authentication = await createLexAuthServices(
    getPool(env.LEX_DATABASE_URL!),
  ).passwordAuth.signIn({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!authentication.ok) redirect("/login?error=invalid_credentials");
  const established = await establishLexSession(
    getPool(env.LEX_DATABASE_URL!),
    authentication,
  );
  if (!established.ok) redirect("/login?error=not_invited");
  const next = safeNext(formData.get("next"));
  if (
    ["owner", "practitioner_admin", "counsel_intake", "counsel_attorney", "platform_support"].includes(
      established.role,
    ) &&
    authentication.tokens.assuranceLevel !== "aal2"
  ) {
    redirect(`/mfa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function lexSignOutAction(): Promise<void> {
  const env = getEnv();
  if (env.LEX_APP_MODE === "production") {
    await destroyLexSession(getPool(env.LEX_DATABASE_URL!));
  }
  redirect("/");
}
