import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireLocalEndpoint } from "./support/survivalBrowserBoundary";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const acceptance = readFileSync("tests/e2e/covariate-survival.spec.ts", "utf8");
const fixture = readFileSync(
  "tests/e2e/fixtures/covariate-survival.ts",
  "utf8",
);

describe("actual installed-life browser acceptance boundary", () => {
  it("fails closed on nonlocal endpoints before disposable fixture writes", () => {
    expect(requireLocalEndpoint("http://localhost:5173", "5173").origin).toBe(
      "http://localhost:5173",
    );
    expect(requireLocalEndpoint("http://127.0.0.1:54321", "54321").origin).toBe(
      "http://127.0.0.1:54321",
    );
    for (const url of [
      "https://app.syncai.ca",
      "https://example.supabase.co",
      "http://localhost:54322",
      "http://localhost:54321/path",
      "http://localhost:54321?token=x",
      "http://localhost:54321#x",
      "http://user:password@localhost:54321",
      "https://localhost:54321",
      "http://127.0.0.2:54321",
    ])
      expect(() => requireLocalEndpoint(url, "54321")).toThrow();
    expect(fixture.indexOf("const config = localConfig()")).toBeLessThan(
      fixture.indexOf("for (const id of [authorId, reviewerId])"),
    );
  });
  it("registers the owned browser acceptance without replacing existing required scenarios", () => {
    const step = workflow.match(
      /name: Golden-path E2E[^\n]*\n\s+run: ([^\n]+)/,
    )?.[1];
    expect(step).toBeDefined();
    for (const path of [
      "golden-path.spec.ts",
      "material-commercial-thread.spec.ts",
      "project-fracas.spec.ts",
      "covariate-survival.spec.ts",
    ])
      expect(step).toContain(`tests/e2e/${path}`);
    expect(acceptance).not.toMatch(
      /test\.(?:skip|fixme)|route\(|routeFromHAR|mock/,
    );
  });
  it("uses real auth/RPCs and two independent browser humans with advisory and stale-source assertions", () => {
    expect(fixture).toContain("auth.signInWithPassword");
    expect(fixture).toContain("auth.getUser(session.access_token)");
    expect(fixture).toContain("not real MFA enrollment");
    expect(acceptance).toContain('test.use({ trace: "off" })');
    for (const witness of [
      "browser.newContext",
      "reviewer other than its author",
      "verified MFA and AAL2",
      "survival_approval_id: null",
      "survival_reviewed_by: fixture.reviewerId",
      "operationalAuthorization: false",
      "Retained advisory refused",
      "13 physical lives · 8 failures",
      "Given survival to 8 operating hours",
      "originHours: 8",
      "liveAssetForecast: false",
      "confidenceInterval: null",
      "record_asset_meter_reading",
      "Source gap",
    ])
      expect(acceptance).toContain(witness);
  });
});
