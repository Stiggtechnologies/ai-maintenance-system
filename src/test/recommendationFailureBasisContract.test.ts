import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sql = readFileSync(
  join(
    root,
    "supabase/migrations/20270102370000_recommendation_failure_basis.sql",
  ),
  "utf8",
);

describe("C8.14 governed recommendation failure basis", () => {
  it("extends the canonical recommendation and reuses canonical risk and FMEA stores", () => {
    expect(sql).toContain("alter table public.recommendations");
    expect(sql).toContain("references public.asset_failure_mode_libraries");
    expect(sql).toContain("from public.risks");
    expect(sql).not.toMatch(/create\s+table/i);
  });

  it("requires a named human and refuses AI attestation", () => {
    expect(sql).toContain("record_recommendation_failure_basis");
    expect(sql).toContain("coalesce(v_role,'') = 'ai_admin'");
    expect(sql).toContain("failure_basis_recorded_by = auth.uid()");
    expect(sql).toContain("failure_basis_recorded_at = now()");
    expect(sql).toContain("insert into public.audit_events");
  });

  it("accepts only reviewed failure modes, identified risk events or an explicit not-applicable basis", () => {
    expect(sql).toContain("v_failure.rcm_status is distinct from 'reviewed'");
    expect(sql).toContain("v_risk.status not in (");
    expect(sql).toContain("'treatment_planned','treatment_active','monitoring','accepted'");
    expect(sql).not.toContain("status not in ('draft','archived')");
    expect(sql).toContain("length(btrim(coalesce(v_risk.event_description,''))) < 20");
    expect(sql).toContain("'not_applicable'");
    expect(sql).toContain("length(btrim(coalesce(p_note,''))) < 20");
  });

  it("enforces tenant and asset consistency without operational authority", () => {
    expect(sql).toContain("organization_id = v_org");
    expect(sql).toContain("failure mode belongs to a different asset");
    expect(sql).toContain("risk scenario belongs to a different asset");
    expect(sql).toContain("'operationalAuthorization',false");
    expect(sql).toContain("does not approve the recommendation");
  });

  it("makes C8.14 visible as advisory posture and binds assumption attestation to it", () => {
    expect(sql).toMatch(
      /\('C8\.14','Failure mode, governed risk scenario or explicit not-applicable basis',\s*false/,
    );
    expect(sql).toContain("'failureModeLibraryId',r.failure_mode_library_id");
    expect(sql).toContain("'failureBasisKind',r.failure_basis_kind");
  });

  it("is customer-reachable from Mission Control through typed RPC calls", () => {
    const page = readFileSync(join(root, "src/pages/MissionControl.tsx"), "utf8");
    const drawer = readFileSync(
      join(root, "src/components/RecommendationFailureBasisDrawer.tsx"),
      "utf8",
    );
    const service = readFileSync(
      join(root, "src/services/recommendationFailureBasisService.ts"),
      "utf8",
    );
    expect(page).toContain("RecommendationFailureBasisDrawer");
    expect(page).toContain("Failure / risk basis");
    expect(drawer).toContain("recordRecommendationFailureBasis");
    expect(service).toContain('"get_recommendation_failure_basis"');
    expect(service).toContain('"record_recommendation_failure_basis"');
  });
});
