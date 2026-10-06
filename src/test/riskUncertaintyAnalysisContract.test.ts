import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const service = readFileSync("src/services/riskOperatingService.ts", "utf8");
const component = readFileSync(
  "src/components/risk/RiskUncertaintyPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const documentation = readFileSync("docs/risk-uncertainty-analysis.md", "utf8");

describe("U18.02 governed uncertainty-analysis contract", () => {
  function body(name: string): string {
    const text = migration.match(
      new RegExp(
        `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
      ),
    )?.[1];
    expect(text, `${name} exists`).toBeDefined();
    return text ?? "";
  }

  it("keeps packet rows, bindings and all public uncertainty doors behind canonical risk visibility", () => {
    expect(migration).toContain(
      "organization_id=public.app_current_org() and public.can_read_risk(risk_id)",
    );
    expect(migration).toContain(
      "a.id=risk_uncertainty_analysis_evidence.analysis_id",
    );
    expect(migration).toContain("a.organization_id=public.app_current_org()");
    expect(migration).toContain(
      "a.organization_id=risk_uncertainty_analysis_evidence.organization_id",
    );
    expect(migration).toContain("and public.can_read_risk(a.risk_id)");
    for (const name of [
      "get_risk_uncertainty_workspace",
      "submit_risk_uncertainty_analysis",
      "review_risk_uncertainty_analysis",
    ]) {
      expect(body(name)).toContain("public.can_read_risk(");
    }
  });

  it("rechecks the locked actor and exact evidence after waits before any uncertainty write", () => {
    for (const name of [
      "submit_risk_uncertainty_analysis",
      "review_risk_uncertainty_analysis",
    ]) {
      const text = body(name);
      const evidenceLock = text.indexOf("for update of e");
      const actorLock = text.indexOf(
        "organization_id,role into v_locked_org,v_role",
      );
      const write = text.indexOf("insert into public.");
      expect(evidenceLock).toBeGreaterThan(-1);
      expect(actorLock).toBeGreaterThan(evidenceLock);
      expect(write).toBeGreaterThan(actorLock);
      expect(text).toContain("where id=v_user for share");
      expect(text).toContain("v_locked_org is distinct from v_org");
      expect(text).toContain("auth.uid() is distinct from v_user");
      expect(text.slice(actorLock, write)).toContain(
        "if not found or auth.uid() is distinct from v_user",
      );
      expect(text.slice(actorLock, write)).toContain(
        "public.app_current_org() is distinct from v_org",
      );
      expect(text.slice(actorLock, write)).toContain(
        "public.can_read_risk(r.id) is distinct from true",
      );
      expect(text.slice(actorLock, write)).toContain("public.can_read_risk(");
      expect(text.slice(evidenceLock, write)).toContain(
        "e.organization_id=v_org and e.risk_id=r.id and e.verification_status='verified'",
      );
    }
    const review = body("review_risk_uncertainty_analysis");
    const riskLock = review.indexOf("select * into r from public.risks");
    const packetLock = review.indexOf(
      "select * into a from public.risk_uncertainty_analyses",
    );
    expect(riskLock).toBeGreaterThan(-1);
    expect(packetLock).toBeGreaterThan(-1);
    expect(review.slice(riskLock, packetLock)).toContain("for update;");
    expect(riskLock).toBeLessThan(packetLock);
    expect(
      review.slice(packetLock, review.indexOf("for update of e")),
    ).toContain("risk_id=r.id for update;");
  });

  it("extends the one canonical risk audit sensitivity guard without dropping prior event families", () => {
    const policy = migration.split(
      "create policy risk_decision_audit_sensitivity on public.audit_events",
    )[1];
    expect(policy).toContain("as restrictive");
    expect(policy).toContain("for select to authenticated");
    expect(policy).toContain(
      "public.can_read_risk(public.sync_text_as_uuid(event_data->>'risk_id'))",
    );
    expect(policy).toContain(
      "public.can_read_risk(public.sync_text_as_uuid(event_data->>'parent_risk_id'))",
    );
    for (const family of [
      "risk_analysis",
      "risk_value_of_information",
      "risk_treatment",
      "risk_treatment_readiness_correction",
      "risk_secondary_created",
      "risk_uncertainty_analysis_submitted",
      "risk_uncertainty_analysis_reviewed",
    ])
      expect(policy).toContain(`'${family}'`);
  });

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
    expect(migration).toContain(
      "when a.analysis_digest is distinct from v_current then 'stale'",
    );
    expect(migration).toContain("analysis changed after submission");
  });

  it("requires independent named-human review and refuses bypasses", () => {
    expect(migration).toContain("analysis author cannot independently review");
    expect(migration).toContain(
      "before insert or update or delete on public.risk_uncertainty_analyses",
    );
    expect(migration).toContain(
      "before truncate on public.risk_uncertainty_analyses",
    );
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
    expect(documentation).toContain(
      "Independent review validates the analysis packet",
    );
  });
});
