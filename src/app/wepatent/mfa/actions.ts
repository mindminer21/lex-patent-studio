"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { getAuthenticatedProviderSession } from "@/lib/server/session";

export type EnrollmentState =
  | { ok: true; factorId: string; qrCode: string; secret: string; next: string }
  | { ok: false; error: string }
  | null;

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  if (next === "/counsel" || next.startsWith("/counsel/")) return next;
  if (next === "/wepatent/app" || next.startsWith("/wepatent/app/")) return next;
  return "/wepatent/app";
}

export async function startMfaEnrollmentAction(
  _state: EnrollmentState,
  formData: FormData,
): Promise<EnrollmentState> {
  const session = await getAuthenticatedProviderSession();
  if (!session) return { ok: false, error: "Your sign-in session expired." };
  const result = await createConsumerAuthServices().mfaAuth.enroll({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  if (!result.ok) return { ok: false, error: "Authenticator setup could not start." };
  return { ...result, next: safeNext(formData.get("next")) };
}

export async function verifyMfaAction(formData: FormData): Promise<void> {
  const parsed = z
    .object({ factorId: z.uuid(), code: z.string().trim().regex(/^\d{6}$/) })
    .safeParse({
      factorId: formData.get("factorId"),
      code: formData.get("code"),
    });
  const next = safeNext(formData.get("next"));
  if (!parsed.success) redirect(`/wepatent/mfa?error=invalid_code&next=${encodeURIComponent(next)}`);
  const session = await getAuthenticatedProviderSession();
  if (!session) redirect("/wepatent/sign-in?error=verification_failed");
  const services = createConsumerAuthServices();
  const result = await services.mfaAuth.verify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (!result.ok) redirect(`/wepatent/mfa?error=invalid_code&next=${encodeURIComponent(next)}`);
  await services.sessions.updateTokens(session.sessionId, {
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresAt: result.tokens.expiresAt,
    assuranceLevel: result.tokens.assuranceLevel,
  });
  redirect(next);
}
