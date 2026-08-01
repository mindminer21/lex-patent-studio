import { afterEach, describe, expect, it } from "vitest";
import { getEnv, isLocalMode, resetEnvCache } from "@/lib/env";

const SAVED = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
  resetEnvCache();
}

describe("environment contract", () => {
  afterEach(restoreEnv);

  it("boots in local mode with ZERO external credentials", () => {
    resetEnvCache();
    delete process.env.LEX_APP_MODE;
    delete process.env.LEX_SUPABASE_URL;
    delete process.env.LEX_STRIPE_SECRET_KEY;
    const env = getEnv();
    expect(env.LEX_APP_MODE).toBe("local");
    expect(isLocalMode()).toBe(true);
  });

  it("production mode refuses to boot without required credentials", () => {
    resetEnvCache();
    process.env.LEX_APP_MODE = "production";
    expect(() => getEnv()).toThrow(/LEX_SUPABASE_URL/);
  });

  it("rejects malformed credential shapes", () => {
    resetEnvCache();
    process.env.LEX_APP_MODE = "local";
    process.env.LEX_STRIPE_SECRET_KEY = "not-a-stripe-key";
    expect(() => getEnv()).toThrow(/Invalid environment/);
  });
});
