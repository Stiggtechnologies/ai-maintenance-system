import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219141000_develop_hybrid_workstreams.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/hybridDevelopmentService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/HybridDevelopmentPanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);
const register = readFileSync("docs/sync-develop/register.md", "utf8");

describe("D1.03 per-workstream hybrid development", () => {
  it("adds a workstream object beneath the canonical Development Case", () => {
    expect(migration).toContain("create table if not exists development_workstreams");
    expect(migration).toContain("references development_cases(id)");
    expect(migration).toContain("unique (development_case_id, workstream_code, version)");
    expect(migration).not.toMatch(/^end \$\$;/m);
  });

  it("supports all section 40 approaches independently inside one case", () => {
    for (const approach of ["predictive", "adaptive", "iterative", "hybrid"]) {
      expect(migration).toContain(`'${approach}'`);
      expect(panel).toContain(`value: "${approach}"`);
    }
    expect(migration).toContain("count(distinct w.development_approach)");
    expect(migration).toContain("'ishybridcase'");
  });

  it("is tenant-bound, human-adopted, versioned, and audited", () => {
    expect(migration).toContain("alter table development_workstreams enable row level security");
    expect(migration).toContain("organization_id = app_current_org()");
    expect(migration).toContain("workstream and development case must belong to the same organization");
    expect(migration).toContain("v_role is null or v_role='ai_admin'");
    expect(migration).toContain("an accountable human project role must adopt");
    expect(migration).toContain("status='retired'");
    expect(migration).toContain("insert into audit_events");
    expect(migration).toContain("'human_determined',true");
    expect(migration).toContain("revoke insert, update, delete, truncate");
  });

  it("keeps missing planning inputs honest rather than manufacturing values", () => {
    expect(panel).toContain('"not recorded"');
    expect(panel).toContain('"not assigned"');
    expect(panel).toContain("this case is not yet operating as a mixed-method case");
  });

  it("is reachable from the customer Development Case Workspace", () => {
    expect(service).toContain('supabase.rpc("record_development_workstream"');
    expect(service).toContain('"get_case_development_workstreams"');
    expect(workspace).toContain("<HybridDevelopmentPanel");
    expect(panel).toContain("Adopt workstream approach");
  });

  it("advances only D1.03 with concrete evidence", () => {
    expect(register).toMatch(/\| D1\.03 \|[^\n]+\| ✅[^\n]+development_workstreams/);
  });
});
