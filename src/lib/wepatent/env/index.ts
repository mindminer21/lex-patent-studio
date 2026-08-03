import { z } from "zod";

/**
 * Validated environment contract (PRD Phase 0).
 *
 * The application runs fully credential-independent in `local` mode: every
 * external dependency (Supabase, Stripe, model providers) is replaced by an
 * in-memory adapter with synthetic data. `production` mode requires the full
 * credential set and fails fast at boot when anything is missing.
 *
 * No provider key is ever exposed to the browser; nothing here is prefixed
 * NEXT_PUBLIC_ except the app URL.
 */
const envSchema = z.object({
  APP_MODE: z.enum(["local", "production"]).default("local"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

  /** Session-cookie HMAC secret. The default is for local mode only. */
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("wepatent-local-dev-secret-not-for-production"),
  /** Salt for privacy-preserving IP hashing on clickwrap records. */
  IP_HASH_SALT: z.string().min(8).default("wepatent-local-ip-salt"),

  // Private application Supabase project (PRD §2.3).
  SUPABASE_URL: z.url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Separate public-corpus Supabase project (PRD §5.8) — never the same
  // credentials as the private project.
  CORPUS_SUPABASE_URL: z.url().optional(),
  CORPUS_SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Stripe (PRD FR-6). The local-mode webhook secret default lets the
  // simulated checkout exercise the real signature-verification path with
  // synthetic events; production rejects it below.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().default("whsec_wepatent_local_synthetic_not_for_production"),
  /**
   * Stripe Price IDs for the self-service subscription plans (FR-6).
   * Optional: subscription checkout for a plan is unavailable until its
   * price ID is configured; wallet top-ups do not require them.
   */
  STRIPE_PRICE_SOLO: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_PROFESSIONAL: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_TEAM: z.string().startsWith("price_").optional(),

  // Model providers, server-side gateway only (PRD FR-5).
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  /** FR-5 kill switch: "1" refuses every model run at the gateway. */
  MODEL_GATEWAY_KILL_SWITCH: z.enum(["0", "1"]).default("0"),

  /**
   * Interview session spend-cap default in cents (Intake Studio FR-INT-10).
   * $5.00 by default; model-touching interview turns halt when a session's
   * settled spend reaches its cap, with an in-product path to raise it.
   */
  INTERVIEW_SESSION_SPEND_CAP_CENTS: z.coerce.number().int().min(0).default(500),
});

export type Env = z.infer<typeof envSchema>;

const PRODUCTION_REQUIRED: Array<keyof Env> = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CORPUS_SUPABASE_URL",
  "CORPUS_SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse({
    APP_MODE: source.APP_MODE,
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
    SESSION_SECRET: source.SESSION_SECRET,
    IP_HASH_SALT: source.IP_HASH_SALT,
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_ANON_KEY: source.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    CORPUS_SUPABASE_URL: source.CORPUS_SUPABASE_URL,
    CORPUS_SUPABASE_SERVICE_ROLE_KEY: source.CORPUS_SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_SOLO: source.STRIPE_PRICE_SOLO,
    STRIPE_PRICE_PROFESSIONAL: source.STRIPE_PRICE_PROFESSIONAL,
    STRIPE_PRICE_TEAM: source.STRIPE_PRICE_TEAM,
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
    XAI_API_KEY: source.XAI_API_KEY,
    MODEL_GATEWAY_KILL_SWITCH: source.MODEL_GATEWAY_KILL_SWITCH,
    INTERVIEW_SESSION_SPEND_CAP_CENTS: source.INTERVIEW_SESSION_SPEND_CAP_CENTS,
  });

  if (parsed.APP_MODE === "production") {
    const missing = PRODUCTION_REQUIRED.filter((key) => !parsed[key]);
    if (missing.length > 0) {
      throw new Error(
        `APP_MODE=production requires the following environment variables: ${missing.join(", ")}`,
      );
    }
    if (parsed.SESSION_SECRET.includes("not-for-production")) {
      throw new Error("APP_MODE=production requires a real SESSION_SECRET");
    }
    if (parsed.STRIPE_WEBHOOK_SECRET.includes("not_for_production")) {
      throw new Error("APP_MODE=production requires a real STRIPE_WEBHOOK_SECRET");
    }
    if (
      parsed.SUPABASE_URL &&
      parsed.CORPUS_SUPABASE_URL &&
      parsed.SUPABASE_URL === parsed.CORPUS_SUPABASE_URL
    ) {
      throw new Error(
        "Private application and public corpus must use separate Supabase projects (PRD §5.8)",
      );
    }
  }

  return parsed;
}

export const env: Env = loadEnv();

export const isLocalMode = env.APP_MODE === "local";
