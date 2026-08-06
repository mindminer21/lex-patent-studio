"use server";

import { redirect } from "next/navigation";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { env, isLocalMode } from "@/lib/wepatent/env";

export async function recoverAction(formData: FormData): Promise<void> {
  if (isLocalMode) redirect("/wepatent/sign-in");
  await createConsumerAuthServices().passwordAuth.requestRecovery({
    email: String(formData.get("email") ?? ""),
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/wepatent/auth/confirm`,
  });
  redirect("/wepatent/recover?status=check_email");
}
