import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20270101980000_recommendation_assumption_contract.sql",
);

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("C5.24 governed recommendation assumptions", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("extends the canonical recommendation instead of creating a parallel model", () => {
    expect(sql).toContain("alter table public.recommendations");
    expect(sql).toContain("assumption_packet jsonb");
    expect(sql).toContain("recommendation_assumption_context_digest");
    expect(sql).toContain("recommendation_evidence_packet_digest");
    expect(sql).not.toMatch(
      /create\s+table[^;]+(recommendation|approval|evidence|audit)/i,
    );
  });

  it("requires a named human to record either explicit assumptions or a justified none-identified disposition", () => {
    expect(sql).toContain("record_recommendation_assumptions");
    expect(sql).toContain("app_current_org()");
    expect(sql).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/i);
    expect(sql).toContain("assumptions_recorded_by = auth.uid()");
    expect(sql).toContain("assumptions_recorded_at = now()");
    expect(sql).toContain("'recorded'");
    expect(sql).toContain("'none_identified'");
    expect(sql).toContain("validation_method");
    expect(sql).toContain("consequence_if_wrong");
  });

  it("rejects bypass writes and records the governed act in the canonical audit trail", () => {
    expect(sql).toContain("app.recommendation_assumption_write");
    expect(sql).toMatch(
      /create\s+trigger\s+trg_recommendation_assumption_provenance/i,
    );
    expect(sql).toContain("'recommendation_assumptions'");
    expect(sql).toContain("insert into public.audit_events");
  });

  it("makes assumptions a binary release requirement in preflight, trigger and posture", () => {
    expect(sql).toContain(
      "create or replace function public.check_recommendation_contract",
    );
    expect(sql).toContain(
      "create or replace function public.recommendation_contract_gaps",
    );
    expect(sql).toContain(
      "create or replace function public.get_recommendation_contract_posture",
    );
    expect(sql).toContain("recommendation_assumption_packet_valid");
    expect(sql).toContain(
      "r.assumption_context_digest = public.recommendation_assumption_context_digest",
    );
    expect(sql).toContain("Assumptions and validation plan (C5.24)");
  });

  it("asserts the non-operational boundary from parsed JSON instead of wire formatting", () => {
    const smoke = read("scripts/ci-recommendation-assumptions-smoke.sh");

    expect(smoke).toContain("field operationalAuthorization");
    expect(smoke).not.toContain('operationalAuthorization":false');
  });

  it("is reachable from Mission Control through one typed service", () => {
    const page = read("src/pages/MissionControl.tsx");
    const drawer = read("src/components/RecommendationAssumptionsDrawer.tsx");
    const service = read("src/services/recommendationAssumptionService.ts");

    expect(page).toContain("RecommendationAssumptionsDrawer");
    expect(page).toContain("onAssumptions");
    expect(drawer).toContain("recordRecommendationAssumptions");
    expect(service).toContain('"get_recommendation_assumption_packet"');
    expect(service).toContain('"record_recommendation_assumptions"');
  });
});
