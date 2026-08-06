"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { getPool } from "@/lib/adapters/production/db";
import { createLexAuthServices } from "@/lib/adapters/production/lex-auth-session";

export async function lexRecoverAction(formData: FormData): Promise<void> {
  const env = getEnv();
  if (env.LEX_APP_MODE !== "production") redirect("/login");
  await createLexAuthServices(getPool(env.LEX_DATABASE_URL!)).passwordAuth.requestRecovery({
    email: String(formData.get("email") ?? ""),
    redirectTo: `${env.NEXT_PUBLIC_LEX_APP_URL}/auth/confirm`,
  });
  redirect("/recover?status=check_email");
}
