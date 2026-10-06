import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  assuranceFixture,
  freshMeterTimestamp,
  requireLocalEndpoint,
} from "./support/survivalBrowserBoundary";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const acceptance = readFileSync("tests/e2e/covariate-survival.spec.ts", "utf8");
const fixture = readFileSync(
  "tests/e2e/fixtures/covariate-survival.ts",
  "utf8",
);

describe("actual installed-life browser acceptance boundary", () => {
  it("uses database observation time strictly after prior meters without fabricating a future timestamp", () => {
    const databaseNow = "2026-10-06T05:30:22.100+00:00";
    expect(freshMeterTimestamp(databaseNow, null)).toBe(
      "2026-10-06T05:30:22.100Z",
    );
    expect(freshMeterTimestamp(databaseNow, "2026-10-06T05:30:21.100Z")).toBe(
      "2026-10-06T05:30:22.100Z",
    );
    for (const previous of [
      databaseNow,
      "2026-10-06T05:30:23.100Z",
      "not-a-time",
    ])
      expect(() => freshMeterTimestamp(databaseNow, previous)).toThrow();
    expect(() => freshMeterTimestamp("not-a-time", null)).toThrow();
    // Sub-millisecond database values must not silently round to the same
    // browser timestamp. Refuse rather than moving an observation into future.
    expect(() =>
      freshMeterTimestamp(
        "2026-10-06T05:30:22.1009Z",
        "2026-10-06T05:30:22.1001Z",
      ),
    ).toThrow();
    expect(fixture).toContain("clock_timestamp()");
    expect(fixture).toContain("max(recorded_at)");
    expect(fixture).toContain(
      "const meterTime = freshLocalSurvivalMeterTimestamp()",
    );
    expect(acceptance).toContain(
      "p_recorded_at: freshLocalSurvivalMeterTimestamp()",
    );
    expect(fixture).not.toContain("Date.now() - 60_000");
    expect(acceptance).not.toContain("Date.now() - 1_000");
  });
  it("declares HS256 for the synthetic HMAC signature without copying an asymmetric key ID", () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const original = {
      sub: "synthetic-user",
      session_id: "actual-session-id",
      aud: "authenticated",
      role: "authenticated",
      iss: "http://127.0.0.1:54321/auth/v1",
      aal: "aal1",
      amr: [{ method: "password", timestamp: 1 }],
    };
    const session = {
      access_token: `${encode({ alg: "ES256", kid: "asymmetric-key" })}.${encode(original)}.original`,
      refresh_token: "synthetic-refresh",
      user: { id: original.sub },
    } as Session;
    const key = "explicit-nonsecret-unit-fixture-key";
    const signed = assuranceFixture(session, key);
    const [header, body, signature] = signed.access_token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    expect(
      JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    ).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(signature).toBe(
      createHmac("sha256", key).update(`${header}.${body}`).digest("base64url"),
    );
    expect(payload).toMatchObject({
      ...original,
      aal: "aal2",
      amr: [...original.amr, { method: "totp", timestamp: payload.iat }],
    });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(signed.expires_at).toBe(payload.exp);
    expect(signed.user).toBe(session.user);
    expect(signed.refresh_token).toBe(session.refresh_token);
    expect(session.access_token.endsWith(".original")).toBe(true);
    expect(original.aal).toBe("aal1");
  });
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
      "Joint conditional hazard sampling uncertainty · 3 assets",
      "Pointwise nominal 95% model confidence bounds",
      'boundsVersion: "cox-model-confidence/1/draft"',
      "coverageValidated: false",
      "futureEventPredictionInterval: false",
      'uncertaintyVersion: "cox-joint-asset/1/draft"',
      "record_asset_meter_reading",
      "Source gap",
    ])
      expect(acceptance).toContain(witness);
  });
  it("targets wrapped selects by their exact accessible combobox name, not option-inclusive label text", () => {
    // Hosted 38e10614 rendered an enabled select but exact getByLabel could
    // not find it because the wrapping label also contains every option.
    // Actual Chromium reproduction: exact label 0, exact role 1.
    const selections = [
      ...acceptance.matchAll(/\.(getBy\w+)\(([^)]*)\)\s*\.selectOption\(/g),
    ];
    expect(selections).toHaveLength(9);
    for (const [, method, args] of selections) {
      expect(method).toBe("getByRole");
      expect(args).toContain('"combobox"');
      expect(args).toContain("exact: true");
    }
  });
  it("retains the single-asset refusal alongside a separate three-asset success with exact-asset evidence", () => {
    expect(acceptance).toContain("for (const multipleAssets of [false, true])");
    expect(acceptance).toContain(
      "Clustered uncertainty cannot be estimated from a single independent asset cluster.",
    );
    expect(acceptance).toContain('status: "refused"');
    expect(acceptance).toContain('status: "computed"');
    expect(acceptance).toContain("fixture.assetIds");
    expect(fixture).toContain("multipleAssets = false");
    expect(fixture).toContain("assetEvidenceIds.get(eventAssetId)");
    expect(fixture).toContain("p_asset_id: eventAssetId");
  });
});
