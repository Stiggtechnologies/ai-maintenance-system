import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219350000_service_contract_recommendation_risk.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const panel = readFileSync(
  "src/components/risk/ServiceContractRiskPanel.tsx",
  "utf8",
);
const service = readFileSync(
  "src/services/serviceContractRiskService.ts",
  "utf8",
);

describe("U13.01 service and contractual recommendation-risk contract", () => {
  it("extends the canonical obligation and recommendation spine", () => {
    expect(sql).toContain("alter table public.risk_obligations");
    expect(sql).toContain("references public.recommendations");
    expect(sql).toContain("references public.asset_service_levels");
    expect(sql).toContain("references public.contract_packages");
    expect(sql).toContain("references public.suppliers");
    expect(sql).toContain("references public.warranty_terms");
    expect(sql).not.toContain(
      "create table if not exists public.service_contract_recommendations",
    );
  });

  it("covers every required commitment family and commercial consequence", () => {
    for (const kind of [
      "availability_guarantee",
      "response_time_guarantee",
      "reliability_guarantee",
      "punctuality_target",
      "service_standard",
      "maintenance_contract",
      "performance_based_logistics",
      "warranty",
      "concession_requirement",
      "penalty_value",
      "incentive_value",
    ]) {
      expect(sql).toContain(kind);
    }
  });

  it("refuses invented targets and preserves evidence provenance", () => {
    expect(sql).toContain("syncai will not invent one");
    expect(sql).toContain("syncai will not infer compliance");
    expect(sql).toContain("e.verification_status<>'verified'");
    expect(sql).toContain("e.organization_id=v_org");
    expect(sql).toContain("evidence_item_ids");
    expect(sql).toContain("missing_evidence");
  });

  it("enforces tenant walls and independent named-human review", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("ai identity is not accepted");
    expect(sql).toContain("created_by=auth.uid()");
    expect(sql).toContain("recorded_by=auth.uid()");
    expect(sql).toContain("author cannot independently");
    expect(sql).toContain("recorded_by<>verified_by");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke insert,update,delete,truncate");
  });

  it("cannot approve recommendations, accept risk, or release work", () => {
    expect(sql).toContain(
      "recommendation remains in its canonical human approval workflow",
    );
    expect(sql).toContain(
      "does not approve, reject, modify, escalate, dismiss or execute",
    );
    expect(sql).not.toContain("insert into public.approvals");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).not.toMatch(/update public\.recommendations\s+set\s+status/);
  });

  it("is customer-reachable in the Risk Operating System", () => {
    expect(page).toContain('id: "contractual"');
    expect(page).toContain("<ServiceContractRiskPanel />");
    expect(panel).toContain("Service &amp; contractual risk");
    expect(panel).toContain("Put obligation in recommendation risk");
    expect(panel).toContain("SyncAI will not infer a guarantee");
    expect(service).toContain('"record_service_contract_obligation"');
    expect(service).toContain('"adopt_service_contract_obligation"');
    expect(service).toContain('"record_recommendation_contract_risk"');
    expect(service).toContain('"verify_recommendation_contract_risk"');
  });
});
