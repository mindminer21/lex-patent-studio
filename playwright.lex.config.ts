import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration (PRD §16). Runs against a production `next start` on a
 * dedicated port; the local-mode in-memory store means tests share one
 * process state, so the suite runs serially (workers: 1) and specs are
 * ordered to avoid state coupling.
 *
 * The environment pins PLAYWRIGHT_BROWSERS_PATH with a pre-provisioned
 * chromium build; executablePath is pinned because the provisioned build
 * revision may differ from this Playwright version's default.
 */

const CHROMIUM_PATH =
  process.env.LEX_CHROMIUM_PATH ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "./e2e/lex",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4123",
    trace: "retain-on-failure",
    launchOptions: { executablePath: CHROMIUM_PATH },
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run start -- -p 4123",
    url: "http://localhost:4123",
    // Fresh server per run: the local-mode store is in-memory, so reusing a
    // server would leak state between suite runs.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
