import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220150000_develop_operational_disruption.sql",
  "utf8",
);

describe("D2.09 operational-disruption persistence", () => {
  it("reuses the canonical option, value, evidence, outage and audit models", () => {
    expect(migration).toContain("references public.business_case_options(id)");
    expect(migration).toContain("references public.lifecycle_evaluations(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("references public.outage_windows(id)");
    expect(migration).toContain("insert into audit_events");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(?:business_case_options|lifecycle_evaluations|evidence_items|outage_windows|audit_events)\s*\(/i,
    );
  });

  it("implements the exact four-term calculation without automatic selection", () => {
    expect(migration).toContain("ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk");
    expect(migration).toContain(
      "v_eval.expected_value-p_construction_disruption_cost-p_production_loss_cost-p_simops_risk_cost",
    );
    expect(migration).toContain("'netOptionValue'");
    expect(migration).toContain("does not rank, recommend, approve or select an option");
    expect(migration).not.toMatch(/recommended_option|preferred_option|auto.?select/i);
  });

  it("requires a brownfield site, an option-specific immutable value and evidence per term", () => {
    expect(migration).toContain("v_case.lifecycle_type<>'brownfield'");
    expect(migration).toContain("v_case.site_id is null");
    expect(migration).toContain("e.evaluation_kind='case_value'");
    expect(migration).toContain("(x->>'optionId')::bigint=p_option_id");
    expect(migration).toContain("p_simops_risk_evidence_item_id");
    expect(migration).toContain("each term requires an evidence item");
  });

  it("preserves tenant, case and site scope at RPC and table walls", () => {
    expect(migration.match(/enable row level security/g)).toHaveLength(2);
    expect(migration).toContain("enforce_option_operational_disruption_scope");
    expect(migration).toContain("enforce_option_operational_disruption_outage_scope");
    expect(migration).toContain("and e.development_case_id=v_case.id");
    expect(migration).toContain("w.site_id=v_case.site_id");
    expect(migration).toContain("No client write policy");
  });

  it("keeps revisions immutable and exposes named gaps", () => {
    expect(migration).toContain("an operational-disruption assessment is immutable; record a new revision");
    expect(migration).toContain("app.option_disruption_write");
    expect(migration).toContain("where superseded_at is null");
    for (const gap of ["ProjectValue evaluation", "ConstructionDisruption", "ProductionLoss", "SIMOPSRisk", "outage scope"]) {
      expect(migration).toContain(`'${gap}'`);
    }
  });
});
