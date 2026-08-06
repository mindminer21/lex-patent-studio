"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { getPool } from "@/lib/adapters/production/db";
import {
  createLexAuthServices,
  destroyLexSession,
  getLexActiveProviderSession,
} from "@/lib/adapters/production/lex-auth-session";

export async function lexResetPasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirmation") ?? "")) {
    redirect("/reset-password?error=mismatch");
  }
  const env = getEnv();
  const pool = getPool(env.LEX_DATABASE_URL!);
  const session = await getLexActiveProviderSession(pool);
  if (!session) redirect("/login?error=invalid_credentials");
  const result = await createLexAuthServices(pool).passwordAuth.updatePassword({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    password,
  });
  if (!result.ok) redirect("/reset-password?error=invalid_password");
  await destroyLexSession(pool);
  redirect("/login?status=password_updated");
}
