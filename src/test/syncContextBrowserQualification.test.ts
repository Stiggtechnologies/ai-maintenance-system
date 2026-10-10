import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Harness wiring assertions only. Actual browser/authentication proof must come
// from execution of this spec against the fresh canonical Supabase chain.
const protectedWrite =
  /\b(?:insert\s+into|update)\s+(?:(?:"public"|public)\s*\.\s*)?"?(?:geospatial_features|geospatial_subject_links|evidence_items|approvals|work_orders)"?(?=\s|[;(]|$)/i;
const disabledGuard =
  /\bdisable\s+(?:trigger|row\s+level\s+security)\b|\bapp\.sync_context_source_write\b/i;
describe("Sync Context authenticated browser qualification wiring", () => {
  it("includes the owned browser witness in the existing golden-path job", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain(
      "scripts/tests/sync-context-browser-fixture.sql",
    );
    expect(workflow).toContain(
      "app.ci_context_browser_fixture=github_actions_only",
    );
    expect(workflow).toContain("tests/e2e/sync-context.spec.ts");
  });
  it("contains isolated base identities without direct protected-model DML or disabled guards", () => {
    const fixture = readFileSync(
      "scripts/tests/sync-context-browser-fixture.sql",
      "utf8",
    );
    expect(fixture).toContain(
      "current_setting('app.ci_context_browser_fixture',true)",
    );
    expect(fixture).toContain("Fort McMurray Oil Sands Demo");
    expect(fixture).toContain("verification_status='verified'");
    expect(fixture).not.toMatch(protectedWrite);
    expect(fixture).not.toMatch(disabledGuard);
  });
  it("recognizes multiline, unqualified and quoted protected DML/guard spellings", () => {
    for (const sql of [
      "insert\ninto geospatial_features(id) values(null)",
      'UPDATE "public" . "geospatial_subject_links" set id=null',
      'insert into public."evidence_items"(id) values(null)',
      "update approvals\nset id=null",
      'insert into "work_orders" (id) values(null)',
    ])
      expect(sql).toMatch(protectedWrite);
    for (const sql of [
      "alter table public.geospatial_features disable\ntrigger all",
      "alter table public.geospatial_features disable row\nlevel security",
      "select set_config('app.sync_context_source_write','granted',true)",
    ])
      expect(sql).toMatch(disabledGuard);
  });
  it("uses real independent authenticated writers, then proves browser revocation and scope", () => {
    const spec = readFileSync("tests/e2e/sync-context.spec.ts", "utf8");
    for (const call of [
      "register_context_source",
      "record_context_source_health",
      "record_geospatial_feature",
      "verify_geospatial_feature",
      "link_geospatial_subject",
      "transition_context_source_rights",
    ])
      expect(spec).toContain(call);
    expect(spec).toContain('"127.0.0.1"');
    expect(spec).toContain('"localhost"');
    expect(spec).toContain("SITE_B");
    expect(spec).toContain("rightsBlocked");
    expect(spec).toContain("sync-context-foreign@syncai.ca");
    expect(spec).toContain("sync-context-tech@syncai.ca");
    expect(spec).not.toMatch(/route\.(?:fulfill|abort)|storageState\s*:/);
  });
});
