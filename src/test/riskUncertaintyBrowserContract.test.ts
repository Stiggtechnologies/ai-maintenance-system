import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";
const spec = read("tests/e2e/risk-uncertainty.spec.ts");
const fixture = read("scripts/tests/risk-uncertainty-browser-fixture.sql");

describe("U18 actual browser acceptance containment", () => {
  it("selects the unique level-two risk detail heading rather than its identically named card", () => {
    const detail =
      spec.match(
        /const detailHeading = page\.getByRole\("heading", \{([^]*?)\}\);/,
      )?.[1] ?? "";
    expect(detail).toContain(
      "name: `U18 browser synthetic cooling risk ${attempt}`",
    );
    expect(detail).toContain("exact: true");
    expect(detail).toContain("level: 2");
    expect(spec).toContain("await expect(detailHeading).toHaveCount(1)");
    expect(spec).toContain("await expect(detailHeading).toBeVisible()");
    expect(spec).not.toMatch(/\.first\(\)|\.nth\(/);
  });
  it("evaluates the reason locator relative to its candidate form, without referring to the panel ancestor", () => {
    const filter =
      spec
        .split(
          'const replacementForm = author.panel.locator("form").filter({',
        )[1]
        ?.split("});")[0] ?? "";
    expect(filter).toContain("has: page.getByPlaceholder(");
    expect(filter).toContain("exact: true");
    expect(filter).not.toContain("author.panel.getByPlaceholder");
  });
  it("scopes the second replacement click to the unique real submission form", () => {
    expect(spec).toContain(
      'const replacementForm = author.panel.locator("form").filter({',
    );
    expect(spec).toContain("await expect(replacementForm).toHaveCount(1)");
    expect(spec).toContain(
      "const replacementSubmit = replacementForm.getByRole",
    );
    expect(spec).toContain("await expect(replacementSubmit).toHaveCount(1)");
    expect(spec).toContain("await replacementSubmit.click()");
    // Only the initial beginReplacement click may use the panel-wide name.
    expect(
      spec.match(
        /await author\.panel\s*\.getByRole\("button", \{ name: "Replace stale analysis", exact: true \}\)\s*\.click\(\)/g,
      ),
    ).toHaveLength(1);
  });
  it("uses real browser submission/review/replacement receipts, not fabricated RPC responses", () => {
    for (const name of [
      "submit_risk_uncertainty_analysis",
      "review_risk_uncertainty_analysis",
      "replace_risk_uncertainty_analysis",
      "get_risk_uncertainty_replacement_receipt",
    ])
      expect(spec).toContain(name);
    expect(spec).toContain("route.fetch()");
    expect(spec).toContain('route.abort("failed")');
    expect(spec).not.toMatch(/route\.fulfill|vi\.mock|service_role/i);
    expect(spec).toContain("Author cannot review this packet.");
    expect(spec).toContain("Retained replacement history");
    expect(spec).toContain("Reconcile replacement");
    expect(spec).toContain("replacementWrites");
  });
  it("isolates both retry attempts and uses insert-only new human identities", () => {
    expect(spec).toContain("testInfo.retry");
    expect(fixture).toContain("generate_series(0,1)");
    expect(fixture).toContain("gen_random_uuid()");
    expect(fixture).toContain("auth.identities");
    expect(fixture).toContain("reliability_engineer");
    expect(fixture).not.toMatch(
      /\b(?:update|delete|truncate)\s+(?:public\.|auth\.)?[a-z_]+|on\s+conflict|disable\s+trigger/i,
    );
    expect(fixture).toContain("set_config('request.jwt.claims','',true)");
    expect(fixture).toContain("set_config('request.jwt.claim.sub','',true)");
  });
  it("pins disposable owner SQL and browser configuration to CI loopback", () => {
    for (const text of [
      "app.ci_u18_browser_fixture",
      "github_actions_only",
      "inet_server_addr()",
      "session_user<>'postgres'",
    ])
      expect(fixture).toContain(text);
    expect(spec).toContain("process.env.GITHUB_ACTIONS");
    expect(spec).toContain('"127.0.0.1"');
    expect(spec).toContain('"54322"');
    expect(spec).toContain("ON_ERROR_STOP=1");
    expect(spec).toContain("PGOPTIONS");
  });
  it("adopts complete explicitly synthetic criteria through the canonical named administrator door", () => {
    expect(fixture).toContain("public.adopt_risk_criteria(");
    expect(fixture).toContain("f.adopter::text");
    expect(fixture).toContain("set local role authenticated");
    expect(fixture).toContain("'admin'");
    for (const field of [
      "consequence_dimensions",
      "likelihood_scale",
      "thresholds",
      "decision_thresholds",
      "scoring_weights",
      "risk_capacity",
    ])
      expect(fixture).toContain(field);
    expect(fixture).not.toMatch(/select criteria,org,[^;]*'adopted'/);
  });
  it("checks frozen predecessor, real digest drift, tenant identity and complete no-operation witness", () => {
    for (const text of [
      "storedAnalysisDigest",
      "currentAnalysisDigest",
      "replacement_required",
      "supersession",
      "requestFingerprint",
      "operationalAuthorization",
      "decisions",
      "work_orders",
      "risk_stakeholder_views",
      "scenarios",
      "beforeOperations",
      "afterOperations",
    ])
      expect(spec).toContain(text);
    expect(spec).toContain("reviewedBy");
    expect(spec).toContain("author_id");
    expect(spec).toContain("organization_id");
    expect(spec).toContain("revision='BROWSER-R2'");
  });
});
