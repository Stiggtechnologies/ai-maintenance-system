import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270102300000_governed_fmea_rcm_decision.sql",
).toLowerCase();
const service = read("src/services/governedRcmService.ts");
const workbench = read("src/components/GovernedRcmWorkbench.tsx");
const host = read("src/pages/ReliabilityPage.tsx");

describe("C7.09/C8.06 governed FMEA/FMECA and RCM", () => {
  it("extends the canonical failure-mode, strategy, evidence and review records", () => {
    for (const source of [
      "public.asset_failure_mode_libraries",
      "public.asset_maintenance_strategy_recommendations",
      "public.recommendation_approval_workflows",
      "public.evidence_items",
      "public.audit_events",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(rcm_analyses|fmea_records|fmeca_records)/,
    );
  });

  it("implements all seven RCM questions without inventing engineering inputs", () => {
    for (const answer of [
      "functionstatement",
      "functionalfailure",
      "failuremode",
      "failureeffect",
      "consequencecategory",
      "taskapplicable",
      "taskeffective",
      "defaultaction",
    ])
      expect(migration).toContain(answer);
    expect(migration).toContain("a default action is only used");
    expect(migration).toContain(
      "question 7 requires an explicit default action",
    );
    expect(migration).toContain("does not invent a scale or rpn");
  });

  it("covers CBM, inspection/failure finding, TBM, RTF and redesign branches", () => {
    for (const strategy of [
      "condition_based",
      "failure_finding",
      "time_based_restoration",
      "time_based_replacement",
      "run_to_failure",
      "redesign",
      "one_time_change",
    ])
      expect(migration).toContain(strategy);
  });

  it("fails closed on unsafe or unproven branches", () => {
    expect(migration).toContain(
      "run-to-failure is refused for safety or environmental consequences",
    );
    expect(migration).toContain(
      "a hidden failure requires failure-finding or a design/change default action",
    );
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.asset_id=p_asset_id");
    expect(migration).toContain("e.organization_id=v_org");
  });

  it("requires independent AAL2 human review and locks governed rows", () => {
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("segregation of duties requires review");
    expect(migration).toContain("app.governed_rcm_write");
    expect(migration).toContain("governed rcm records are retained");
  });

  it("keeps engineering review separate from operational authority", () => {
    for (const boundary of [
      "'changesmaintenanceplan',false",
      "'createswork',false",
      "'acceptsrisk',false",
      "'commitsspend',false",
      "'changesoperatinglimits',false",
      "'returnstoservice',false",
    ])
      expect(migration).toContain(boundary);
  });

  it("is customer-operable from the canonical reliability surface", () => {
    expect(service).toContain('"get_governed_rcm_workspace"');
    expect(service).toContain('"submit_governed_rcm_analysis"');
    expect(service).toContain('"review_governed_rcm_analysis"');
    expect(workbench).toContain("Seven-question RCM");
    expect(workbench).toContain("Verified asset");
    expect(workbench).toContain("evidence");
    expect(workbench).toContain("Approve engineering disposition");
    expect(host).toContain("<GovernedRcmWorkbench />");
  });
});
