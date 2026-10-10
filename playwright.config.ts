import { defineConfig, devices } from "@playwright/test";

/**
 * Golden-path E2E config.
 *
 * Prereq: local Supabase running with a FRESH demo state:
 *   supabase start && supabase db reset
 *
 * The Vite dev server is started by Playwright itself (webServer below) with
 * env pinned to the LOCAL Supabase stack — a .env.local pointing at the cloud
 * project cannot leak into E2E runs.
 *
 * Run: npm run test:e2e
 */

// Standard supabase-cli local demo anon key (identical across local projects).
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const localSupabaseUrl =
  process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const localEndpoint = new URL(localSupabaseUrl);
if (
  localEndpoint.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(localEndpoint.hostname) ||
  localEndpoint.port !== "54321" ||
  localEndpoint.username ||
  localEndpoint.password ||
  localEndpoint.pathname !== "/" ||
  localEndpoint.search ||
  localEndpoint.hash
) {
  throw new Error(
    "Browser acceptance requires the fixed disposable loopback Supabase endpoint",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // golden-path tests are sequential and stateful
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 90_000,

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

  webServer: {
    command: "npx vite --port 5173 --strictPort",
    port: 5173,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: localSupabaseUrl,
      VITE_SUPABASE_ANON_KEY:
        process.env.E2E_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY,
      // This takes precedence over ANON_KEY in supabase-config.ts. An inherited
      // .env.local publishable key must not override the local E2E key.
      VITE_SUPABASE_PUBLISHABLE_KEY: "",
      VITE_ENVIRONMENT: "e2e",
    },
  },
});
