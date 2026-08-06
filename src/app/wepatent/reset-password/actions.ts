"use server";

import { redirect } from "next/navigation";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import {
  destroySession,
  getAuthenticatedProviderSession,
} from "@/lib/server/session";

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password !== confirmation) {
    redirect("/wepatent/reset-password?error=mismatch");
  }
  const session = await getAuthenticatedProviderSession();
  if (!session) redirect("/wepatent/sign-in?error=verification_failed");
  const result = await createConsumerAuthServices().passwordAuth.updatePassword({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    password,
  });
  if (!result.ok) redirect("/wepatent/reset-password?error=invalid_password");
  await destroySession();
  redirect("/wepatent/sign-in?status=password_updated");
}
