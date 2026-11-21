import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271112120000_stage3_defect_elimination_governance.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/defectEliminationGovernanceService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/DefectEliminationGovernance.tsx",
  "utf8",
);
const elimination = readFileSync(
  "src/components/FailureModeElimination.tsx",
  "utf8",
);
const reliability = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");

function body(name: string): string {
  const marker = `function public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, name).toBeGreaterThan(-1);
  const next = migration.indexOf(
    "create or replace function",
    start + marker.length,
  );
  return migration.slice(start, next === -1 ? undefined : next);
}

describe("Stage 3 defect-elimination governance", () => {
  it("freezes canonical FRACAS, RCA, PM and Weibull records without recomputing them", () => {
    const record = body("record_defect_elimination_governance");
    expect(record).toContain("public.fracas_investigation_packs");
    expect(record).toContain("public.fracas_investigation_assignments");
    expect(record).toContain("public.asset_strategy_assessments");
    expect(record).toContain("public.reliability_life_data_reports");
    expect(record).toContain("public.component_life_events");
    expect(record).toContain("public.get_failure_mode_elimination_rate()");
    expect(record).toContain("'mle', 'mle_censored', 'rank_regression'");
    expect(record).toContain(
      "an unidentified distribution cannot govern defect elimination",
    );
    expect(record).not.toMatch(
      /weibullMLE|fitCox|pm_policy_assessments|physical_life_ref/,
    );
    expect(migration).not.toMatch(/insert\s+into\s+public\.work_orders/i);
    expect(migration).not.toMatch(/update\s+public\.maintenance_plans/i);
    expect(migration).not.toMatch(
      /update\s+public\.asset_strategy_assessments/i,
    );
    expect(migration).not.toMatch(
      /update\s+public\.reliability_life_data_reports/i,
    );
  });

  it("refuses the AI operator before the human allow-list and blocks self-governance", () => {
    const record = body("record_defect_elimination_governance");
    const ai = record.indexOf("= 'ai_admin'");
    const humans = record.indexOf(
      "not in ('reliability_engineer', 'maintenance_manager', 'admin')",
    );
    expect(ai).toBeGreaterThan(-1);
    expect(humans).toBeGreaterThan(ai);
    expect(record).toContain(
      "the AI-operator identity cannot govern defect elimination",
    );
    expect(record).toContain(
      "the assigned RCA investigator cannot govern their own defect-elimination decision",
    );
    expect(record).toContain("organization_id = v_org");
    expect(record).not.toMatch(/p_organization_id/);
  });

  it("is append-only, tenant-scoped, audited, and without execution authority", () => {
    expect(migration).toContain(
      "defect-elimination governance records are append-only",
    );
    expect(migration).toContain(
      "using (organization_id = public.app_current_org())",
    );
    expect(migration).toContain(
      "revoke insert, update, delete, truncate on public.defect_elimination_governances",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'mayCreateWork', false");
    expect(migration).toContain("'mayChangePmInterval', false");
    expect(migration).toContain("'mayApproveStrategy', false");
    expect(migration).toContain("'mayAcceptRisk', false");
    expect(migration).toContain("'mayCommitSpend', false");
    expect(migration).toContain("'mayReturnToService', false");
    expect(migration).toContain(
      "revoke all on function public.record_defect_elimination_governance(uuid, uuid, uuid, uuid, text, text)",
    );
    expect(migration).toContain(
      "grant execute on function public.record_defect_elimination_governance(uuid, uuid, uuid, uuid, text, text)",
    );
    expect(migration).toContain("to authenticated");
    const record = body("record_defect_elimination_governance");
    expect(record).toContain("security definer");
    expect(record).toContain("set search_path = public");
  });

  it("is customer-reachable from the reliability elimination surface", () => {
    expect(service).toContain('"get_defect_elimination_governance"');
    expect(service).toContain('"record_defect_elimination_governance"');
    expect(panel).toContain("Record governance decision");
    expect(panel).toContain("loadDefectEliminationGovernance");
    expect(panel).toContain("recordDefectEliminationGovernance");
    expect(elimination).toContain("<DefectEliminationGovernance />");
    expect(reliability).toContain("<FailureModeElimination />");
  });
});
