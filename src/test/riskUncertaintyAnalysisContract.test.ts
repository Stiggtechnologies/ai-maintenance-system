import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101430000_risk_uncertainty_analysis.sql",
  "utf8",
);
const service = readFileSync("src/services/riskOperatingService.ts", "utf8");
const component = readFileSync(
  "src/components/risk/RiskUncertaintyPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const documentation = readFileSync(
  "docs/risk-uncertainty-analysis.md",
  "utf8",
);

describe("U18.02 governed uncertainty-analysis contract", () => {
  it("extends the canonical risk, evidence, approval and audit models", () => {
    expect(migration).toContain("references public.risks(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toContain("create table public.risk_approvals");
    expect(migration).not.toContain("create table public.risk_evidence");
  });

  it("persists every U18.02 dimension without inventing engineering values", () => {
    for (const field of [
      "probability_lower",
      "probability_central",
      "probability_upper",
      "confidence_level",
      "confidence_interval_lower",
      "confidence_interval_upper",
      "best_case_loss",
      "expected_case_loss",
      "worst_case_loss",
      "sensitivity_inputs",
      "sensitivity_results",
      "decision_thresholds",
      "reassessment_triggers",
      "voi_expected_value",
      "voi_net_value",
      "voi_recommendation",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("criteria profile must be adopted");
    expect(migration).toContain("verified evidence linked to this exact risk");
    expect(migration).toContain("best <= expected <= worst");
  });

  it("freezes exact evidence and adopted-threshold provenance with stale detection", () => {
    expect(migration).toContain("risk_uncertainty_analysis_digest");
    expect(migration).toContain("verificationStatus',e.verification_status");
    expect(migration).toContain("decisionThresholds',a.decision_thresholds");
    expect(migration).toContain("when a.analysis_digest is distinct from v_current then 'stale'");
    expect(migration).toContain("analysis changed after submission");
  });

  it("requires independent named-human review and refuses bypasses", () => {
    expect(migration).toContain("analysis author cannot independently review");
    expect(migration).toContain("before insert or update or delete on public.risk_uncertainty_analyses");
    expect(migration).toContain("before truncate on public.risk_uncertainty_analyses");
    expect(migration).toContain("from public,anon,service_role");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("operationalAuthorization',false");
  });

  it("is customer-operable in the canonical Risk Operating System", () => {
    expect(service).toContain('"get_risk_uncertainty_workspace"');
    expect(service).toContain('"submit_risk_uncertainty_analysis"');
    expect(service).toContain('"review_risk_uncertainty_analysis"');
    expect(component).toContain("Probability and confidence");
    expect(component).toContain("Sensitivity ranking");
    expect(component).toContain("Value of information");
    expect(component).toContain("does not accept risk or authorize operation");
    expect(page).toContain("<RiskUncertaintyPanel");
    expect(workflow).toContain("ci-risk-uncertainty-analysis-smoke.sh");
    expect(documentation).toContain("Independent review validates the analysis packet");
  });
});
