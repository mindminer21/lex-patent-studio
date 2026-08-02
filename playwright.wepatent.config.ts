import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * E2E configuration (PRD §13): headless Chromium against `next start` in
 * credential-independent local mode with synthetic data only.
 *
 * The container pre-installs Chromium at /opt/pw-browsers (build 1194);
 * when that build does not match this Playwright version's pinned
 * revision, the explicit executablePath below keeps the suite runnable
 * without downloading browsers (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "./e2e/wepatent",
  // The local adapter is in-memory inside one `next start` process; specs
  // build on each other's tenants deliberately, so keep one worker.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3300",
    trace: "off",
    launchOptions: existsSync(PREINSTALLED_CHROMIUM)
      ? { executablePath: PREINSTALLED_CHROMIUM }
      : {},
  },
  webServer: {
    command: "npm run start -- --port 3300",
    url: "http://localhost:3300/wepatent",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
