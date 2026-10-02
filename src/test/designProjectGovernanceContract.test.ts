import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101290000_design_project_governance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/syncTransitionService.ts", "utf8");
const transition = readFileSync("src/pages/SyncTransitionPage.tsx", "utf8");
const design = readFileSync("src/components/ReliabilityByDesign.tsx", "utf8");
const requirements = readFileSync(
  "src/components/develop/CaseChainsPanels.tsx",
  "utf8",
);
const studies = readFileSync(
  "src/components/develop/FrontlineDesignPanels.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-design-project-governance-smoke.sh",
  "utf8",
);
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E8 reliability-by-design activation", () => {
  it("adds only the retained relationship between canonical observations and requirements", () => {
    expect(migration.match(/create table/g)).toHaveLength(1);
    expect(migration).toContain(
      "create table if not exists public.early_life_failure_requirements",
    );
    for (const canonical of [
      "public.early_life_failures",
      "public.design_requirements",
      "public.evidence_items",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
    expect(migration).not.toContain("design_requirements_v2");
    expect(migration).not.toContain("evidence_items_v2");
  });

  it("refuses direct writes and derives closure only from a verified linked requirement", () => {
    expect(migration).toContain("app.early_life_observation_write");
    expect(migration).toContain("app.early_life_feedback_write");
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("refresh_early_life_feedback_summary");
    expect(migration).toContain("early-life feedback links are immutable");
    expect(migration).toContain(
      "only verified requirement evidence counts as elimination",
    );
    expect(migration).toContain("from public,anon,service_role");
  });

  it("keeps the existing requirement and equipment-study writers customer reachable", () => {
    expect(requirements).toContain("recordCaseRequirement(caseId");
    expect(requirements).toContain(
      "Record on the one project requirement table",
    );
    expect(studies).toContain('value="equipment_selection"');
    expect(studies).toContain("recordCaseDesignStudy(caseId");
  });

  it("runs standardization against live tenant assets and states incomplete-data limits", () => {
    expect(design).toContain("assessStandardisation([...grouped.values()])");
    expect(design).toContain(
      '.from("assets").select("asset_class, manufacturer, model")',
    );
    expect(design.replace(/\s+/g, " ")).toContain(
      "incomplete asset(s) are excluded",
    );
    expect(design).toContain("No fleet-wide conclusion is made");
  });

  it("makes early-life linkage reachable from Sync Transition and exercises it in CI", () => {
    for (const rpc of [
      "get_case_early_life_feedback_workspace",
      "link_case_early_life_failure",
    ]) {
      expect(service).toMatch(new RegExp(`supabase\\.rpc\\(\\s*"${rpc}"`));
    }
    expect(transition).toContain("<EarlyLifeFeedbackControls");
    expect(workflow).toContain(
      "bash scripts/ci-design-project-governance-smoke.sh",
    );
    expect(smoke).toContain(
      "join capital_projects cp on cp.id=dc.capital_project_id and cp.organization_id=dc.organization_id",
    );
  });

  it("advances only the four capabilities proven by the slice", () => {
    for (const id of ["E8.01", "E8.03", "E8.06", "E8.13"]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`),
      );
    }
  });
});
