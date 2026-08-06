"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { env, isLocalMode } from "@/lib/wepatent/env";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(12).max(512),
  displayName: z.string().trim().min(1).max(120),
});

export async function signUpAction(formData: FormData): Promise<void> {
  if (isLocalMode) redirect("/wepatent/sign-in");
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) redirect("/wepatent/sign-up?error=invalid_input");
  const result = await createConsumerAuthServices().passwordAuth.signUp({
    ...parsed.data,
    emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/wepatent/auth/confirm`,
  });
  redirect(
    result.ok
      ? "/wepatent/sign-up?status=check_email"
      : "/wepatent/sign-up?error=request_failed",
  );
}
