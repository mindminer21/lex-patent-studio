"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getPool } from "@/lib/adapters/production/db";
import {
  createLexAuthServices,
  getLexActiveProviderSession,
} from "@/lib/adapters/production/lex-auth-session";

export type LexEnrollmentState =
  | { ok: true; factorId: string; qrCode: string; secret: string; next: string }
  | { ok: false; error: string }
  | null;

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  return next === "/app" || next.startsWith("/app/") ? next : "/app";
}

export async function startLexMfaEnrollmentAction(
  _state: LexEnrollmentState,
  formData: FormData,
): Promise<LexEnrollmentState> {
  const env = getEnv();
  const pool = getPool(env.LEX_DATABASE_URL!);
  const session = await getLexActiveProviderSession(pool);
  if (!session) return { ok: false, error: "Your sign-in session expired." };
  const result = await createLexAuthServices(pool).mfaAuth.enroll({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  if (!result.ok) return { ok: false, error: "Authenticator setup could not start." };
  return { ...result, next: safeNext(formData.get("next")) };
}

export async function verifyLexMfaAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ factorId: z.uuid(), code: z.string().trim().regex(/^\d{6}$/) })
    .safeParse({ factorId: formData.get("factorId"), code: formData.get("code") });
  const next = safeNext(formData.get("next"));
  if (!parsed.success) redirect(`/mfa?error=invalid_code&next=${encodeURIComponent(next)}`);
  const env = getEnv();
  const pool = getPool(env.LEX_DATABASE_URL!);
  const session = await getLexActiveProviderSession(pool);
  if (!session) redirect("/login?error=invalid_credentials");
  const services = createLexAuthServices(pool);
  const result = await services.mfaAuth.verify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (!result.ok) redirect(`/mfa?error=invalid_code&next=${encodeURIComponent(next)}`);
  await services.sessions.updateTokens(session.sessionId, {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresAt: result.tokens.expiresAt,
    assuranceLevel: result.tokens.assuranceLevel,
  });
  redirect(next);
}
