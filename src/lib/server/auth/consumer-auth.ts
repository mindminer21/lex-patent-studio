import "server-only";

import { createSupabasePasswordAuth } from "@/lib/shared/auth/supabase-password";
import { createSupabaseMfaAuth } from "@/lib/shared/auth/supabase-mfa";
import { ServerSessionService } from "@/lib/shared/auth/server-session";
import { env } from "@/lib/wepatent/env";
import { createConsumerSupabaseAuthRepository } from "./consumer-session-repository";

export function createConsumerAuthServices() {
  if (
    env.APP_MODE !== "production" ||
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.AUTH_SESSION_ENCRYPTION_KEY
  ) {
    throw new Error("Consumer production authentication is not configured.");
  }
  const repository = createConsumerSupabaseAuthRepository({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return {
    passwordAuth: createSupabasePasswordAuth({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
    }),
    mfaAuth: createSupabaseMfaAuth({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
    }),
    repository,
    sessions: new ServerSessionService(repository, env.AUTH_SESSION_ENCRYPTION_KEY),
  };
}
