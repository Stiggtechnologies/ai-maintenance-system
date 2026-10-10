import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";
import inherited from "./playwright.config";

// Qualification-only wrapper: preserve the shared suites/configuration while
// refusing unsafe targets BEFORE Playwright starts Vite or loads test fixtures.
// This hash admits only the existing public supabase-demo anonymous fixture key,
// not an arbitrary JWT with an asserted anon role or a privileged local key.
const demoAnonHash =
  "bf1725a8f98bea37e88618702e725ba84bd8acdb2647c5e0ed638bfd685791cf";
const server = inherited.webServer;
const projects = inherited.projects ?? [];
const chromium = projects.find((project) => project.name === "chromium");
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  Object.keys(process.env).some(
    (name) =>
      name.startsWith("PG") ||
      name.startsWith("DOCKER") ||
      name.startsWith("CONTAINER_"),
  ) ||
  !server ||
  Array.isArray(server) ||
  !chromium ||
  inherited.use?.baseURL !== "http://localhost:5173" ||
  server.reuseExistingServer !== false ||
  server.env?.VITE_ENVIRONMENT !== "e2e" ||
  server.env?.VITE_SUPABASE_URL !== "http://127.0.0.1:54321" ||
  typeof server.env?.VITE_SUPABASE_ANON_KEY !== "string" ||
  createHash("sha256")
    .update(server.env.VITE_SUPABASE_ANON_KEY)
    .digest("hex") !== demoAnonHash
) {
  // Never print the rejected key, target, environment or provider diagnostics.
  throw new Error("U18 browser configuration refused");
}

export default defineConfig({
  ...inherited,
  projects: [
    ...projects.map((project) => ({
      ...project,
      testIgnore: [
        ...(project.testIgnore === undefined
          ? []
          : Array.isArray(project.testIgnore)
            ? project.testIgnore
            : [project.testIgnore]),
        "**/risk-uncertainty.spec.ts",
      ],
    })),
    {
      name: "u18-chromium",
      testMatch: "**/risk-uncertainty.spec.ts",
      // Authentication-bearing failure contexts never enter the uploaded
      // test-results tree. Ordinary suites retain their existing diagnostics.
      outputDir: "test-results-private/u18",
      use: { ...chromium.use, trace: "off", video: "off", screenshot: "off" },
    },
  ],
});
