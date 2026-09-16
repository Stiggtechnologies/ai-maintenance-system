import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219440000_methodology_outcome_learning.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/developService.ts", "utf8");
const surface = readFileSync(
  "src/components/develop/MethodologyLearningPanel.tsx",
  "utf8",
);
const shelf = readFileSync(
  "src/components/develop/FrameworkShelfPanel.tsx",
  "utf8",
);

describe("D9.08-D9.09 methodology outcome learning contract", () => {
  it("reuses canonical method, execution, outcome, evidence, lineage and proposal families", () => {
    for (const symbol of [
      "project_frameworks",
      "stage_gate_criteria",
      "stage_gate_reviews",
      "stage_gate_findings",
      "learning_events",
      "evidence_items",
      "calculation_runs",
      "framework_proposals",
    ]) {
      expect(migration).toContain(symbol);
    }
    expect(migration).not.toContain("create table public.methodology_");
  });

  it("uses latest findings, hard two-sided cohort floors and non-causal output", () => {
    expect(migration).toContain(
      "order by r.reviewed_at desc,r.id desc limit 1",
    );
    expect(migration).toContain("greatest(coalesce(p_minimum_cohort,3),3)");
    expect(migration).toContain("met_n>=v_min and not_met_n>=v_min");
    expect(migration).toContain("'associationnotcausation',true");
    expect(migration).toContain("'automaticmethodchange',false");
    expect(migration).toContain(
      "corr((case when o.status='met' then 1 else 0 end)::numeric",
    );
  });

  it("snapshots exact findings, reviews, outcomes and evidence in immutable calculation runs", () => {
    for (const key of [
      /'table','stage_gate_findings','id',\s*finding_id/,
      /'reviewid',\s*review_id/,
      /'outcomeid',\s*outcome_id/,
      /'evidenceitemid',\s*project_outcome_evidence_id/,
    ]) {
      expect(migration).toMatch(key);
    }
    expect(migration).toContain("'methodology_outcome_analysis'");
  });

  it("creates only a draft next version and leaves adoption at the existing human boundary", () => {
    expect(migration).toContain("create_project_framework_version(sf.id)");
    expect(migration).toContain("set_gate_requirement(");
    expect(migration).not.toContain("perform public.adopt_project_framework");
    expect(migration).not.toContain("select public.adopt_project_framework");
    expect(migration).toContain(
      "the ai-operator identity may compute associations but cannot choose a methodology change",
    );
  });

  it("is reachable from the canonical shelf and exposes refusals and the decision boundary", () => {
    expect(service).toContain("runMethodologyOutcomeAnalysis");
    expect(service).toContain("proposeMethodologyImprovement");
    expect(surface).toContain("association ≠ causation");
    expect(surface).toContain("governs nothing until");
    expect(shelf).toContain("<MethodologyLearningPanel");
  });
});
