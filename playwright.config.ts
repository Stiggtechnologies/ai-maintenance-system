import { defineConfig, devices } from "@playwright/test";

/**
 * Golden-path E2E config.
 *
 * Expects:
 *   - Vite dev server running on http://localhost:5173
 *   - Supabase local dev running (supabase start)
 *   - LLM mock server running on http://localhost:54400
 *   - Test user seeded (see scripts/dev-full.sh)
 *
 * Run: npm run test:e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // golden-path tests are sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Vite dev server is started by scripts/dev-full.sh, not here.
  // In CI, the workflow starts it before running playwright.
});
