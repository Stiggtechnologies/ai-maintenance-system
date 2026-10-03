import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101240000_risk_decision_preview_context.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const service = readFileSync("src/services/riskOperatingService.ts", "utf8");
const engine = readFileSync("src/lib/risk-operating-system/index.ts", "utf8");

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    ),
  );
  expect(match, `${name} should be defined in the migration`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("R4.02 / U18.02 / R5.03 governed decision previews", () => {
  it("binds the preview to the exact visible risk and its criteria profile", () => {
    expect(migration).toContain(
      "create or replace function public.get_risk_decision_preview_context",
    );
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("public.can_read_risk(id)");
    expect(migration).toContain("id = v_risk.criteria_profile_id");
    expect(migration).toContain("'scoring_weights'");
    expect(migration).toContain("'time_factors'");
    expect(migration).not.toContain("order by v_criteria.version");
  });

  it("derives competency readiness from active, unexpired canonical holdings", () => {
    expect(migration).toContain("join public.member_competencies");
    expect(migration).toContain("join public.workforce_members");
    expect(migration).toContain("and wm.active");
    expect(migration).toContain(
      "mc.expires_on is null or mc.expires_on >= current_date",
    );
    expect(migration).toContain("mc.granted_on <= current_date");
    expect(migration).toContain("select distinct c.competency_key");
  });

  it("is read-only, advisory, and cannot create decision authority", () => {
    const preview = functionBody("get_risk_decision_preview_context");
    expect(preview).toContain("'advisory_only', true");
    expect(preview).toContain("'human_decision_required', true");
    expect(migration).toContain("revoke execute");
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(preview).not.toMatch(/insert\s+into/);
    expect(preview).not.toMatch(/update\s+/);
    expect(preview).not.toMatch(/delete\s+from/);
  });

  it("puts sensitivity and human-role gates in front of every authoritative writer", () => {
    for (const name of [
      "record_risk_analysis",
      "record_risk_value_of_information",
      "create_risk_treatment",
    ]) {
      const body = functionBody(name);
      expect(body).toContain("public.can_read_risk(p_risk_id)");
      expect(body).toContain("select role into v_role from public.user_profiles");
      expect(body).toContain("'reliability_engineer'");
      expect(body).toContain("'maintenance_manager'");
      expect(body).not.toContain("'ai_admin'");
    }
    expect(migration).toContain(
      "revoke all on function public.record_risk_analysis_authoritative_internal",
    );
    expect(migration).toContain(
      "revoke all on function public.record_risk_value_of_information_authoritative_internal",
    );
    expect(migration).toContain(
      "revoke all on function public.create_risk_treatment_authoritative_internal",
    );
  });

  it("cannot treat a future-dated competency as ready", () => {
    const treatment = functionBody("create_risk_treatment");
    expect(treatment).toContain("mc.granted_on <= current_date");
    expect(treatment).toContain("v_competency_gaps");
    expect(treatment).toContain("update public.scenarios");
  });

  it("wires every deterministic engine into a customer-reachable risk action", () => {
    expect(service).toContain('"get_risk_decision_preview_context"');
    expect(page).toContain("getRiskDecisionPreviewContext(risk.id)");
    expect(page).toContain("analyzeRisk(input, previewCriteria)");
    expect(page).toContain("evaluateValueOfInformation({");
    expect(page).toContain("assessTreatmentReadiness({");
    expect(page).toContain('data-testid="risk-analysis-preview"');
    expect(page).toContain('data-testid="value-of-information-preview"');
    expect(page).toContain('data-testid="treatment-readiness-preview"');
  });

  it("uses the risk-bound time factor and keeps recording authoritative", () => {
    expect(engine).toContain("timePressure * criteria.weights.timePressure");
    expect(page).toContain("Recording runs the same calculation again in the");
    expect(page).toContain("requires a separate human approval");
    expect(page).toContain(
      "Competencies come from current, unexpired holdings",
    );
  });
});
