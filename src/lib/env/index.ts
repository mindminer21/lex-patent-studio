import { z } from "zod";

/**
 * Environment contract for Lex Patent Studio.
 *
 * The application must boot and run fully in "local" mode with ZERO external
 * credentials. Every external dependency (Supabase, Stripe, model providers)
 * sits behind a typed adapter interface (src/lib/adapters) whose local
 * implementation needs nothing from the environment.
 *
 * Hard rule (PRD §7, invariant 17 and the no-live-API constraint): no real
 * API key is ever required, read, or shipped for Round 1. The credential
 * fields below exist only as the *contract* the real adapters will validate
 * against when they are implemented. They are optional and unused in local
 * mode.
 */

export const APP_MODES = ["local", "production"] as const;
export type AppMode = (typeof APP_MODES)[number];

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    /**
     * Deployment mode of the app itself.
     * - "local": in-memory adapters, synthetic seed data, no credentials.
     * - "production": real adapters required; refuses to boot without them.
     */
    LEX_APP_MODE: z.enum(APP_MODES).default("local"),
    NEXT_PUBLIC_LEX_APP_URL: z.string().url().default("http://localhost:3000"),

    // ---- Private application project (Supabase) — production mode only ----
    LEX_SUPABASE_URL: z.string().url().optional(),
    LEX_SUPABASE_ANON_KEY: z.string().min(20).optional(),
    LEX_SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    LEX_SESSION_SECRET: z.string().min(16).optional(),
    /** Base64-encoded 32-byte AES key for provider tokens in auth_sessions. */
    LEX_AUTH_SESSION_ENCRYPTION_KEY: z.string().optional(),
    /** Direct Postgres connection string (Supabase database URL). The
     *  production data adapter runs on SQL so it is testable against a plain
     *  PostgreSQL 16 server without any Supabase credentials. */
    LEX_DATABASE_URL: z.string().min(10).optional(),

    // ---- Public knowledge-corpus project (separate credentials, PRD §6.3) ----
    LEX_CORPUS_SUPABASE_URL: z.string().url().optional(),
    LEX_CORPUS_SUPABASE_ANON_KEY: z.string().min(20).optional(),

    // ---- Billing (Stripe) — production mode only ----
    LEX_STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    LEX_STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),

    // ---- Model gateway (server-side only; never client-exposed) ----
    LEX_OPENAI_API_KEY: z.string().min(20).optional(),
    LEX_ANTHROPIC_API_KEY: z.string().min(20).optional(),
    LEX_XAI_API_KEY: z.string().min(20).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.LEX_APP_MODE === "production") {
      const required: Array<keyof typeof env> = [
        "LEX_SUPABASE_URL",
        "LEX_SUPABASE_ANON_KEY",
        "LEX_SUPABASE_SERVICE_ROLE_KEY",
        "LEX_DATABASE_URL",
        "LEX_SESSION_SECRET",
        "LEX_AUTH_SESSION_ENCRYPTION_KEY",
        "LEX_STRIPE_SECRET_KEY",
        "LEX_STRIPE_WEBHOOK_SECRET",
      ];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when LEX_APP_MODE=production`,
          });
        }
      }
      if (env.NEXT_PUBLIC_LEX_APP_URL.includes("localhost")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NEXT_PUBLIC_LEX_APP_URL"],
          message: "must be the deployed HTTPS origin in production",
        });
      }
      if (env.LEX_AUTH_SESSION_ENCRYPTION_KEY) {
        const authKey = Buffer.from(env.LEX_AUTH_SESSION_ENCRYPTION_KEY, "base64");
        if (authKey.length !== 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["LEX_AUTH_SESSION_ENCRYPTION_KEY"],
            message: "must be a 32-byte base64 value",
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parse and cache the environment. Throws a readable error on violation. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: clear the cached parse. */
export function resetEnvCache(): void {
  cached = null;
}

export function isLocalMode(): boolean {
  return getEnv().LEX_APP_MODE === "local";
}
