import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270102290000_asset_lifecycle_stage_gates.sql",
).toLowerCase();
const service = read("src/services/assetLifecycleGateService.ts");
const panel = read("src/components/AssetLifecycleGateWorkspace.tsx");
const host = read("src/pages/LifecyclePositionPage.tsx");
const smoke = read("scripts/ci-asset-lifecycle-stage-gates-smoke.sh");
const workflow = read(".github/workflows/ci.yml");
const register = read("docs/enterprise-readiness/capability-register.md");

describe("U4.11/U4.12/U4.14 governed lifecycle stage gates", () => {
  it("closes each optional workspace CASE before closing the response object", () => {
    expect(migration).toMatch(
      /'disposal',case when p_asset_id is null then null else \([\s\S]*?and d\.asset_id=p_asset_id\) end\s*\);/,
    );
  });

  it("extends the canonical lifecycle, gate, evidence, evaluation and disposal records", () => {
    for (const source of [
      "public.asset_lifecycle_state",
      "public.asset_lifecycle_transitions",
      "public.stage_gate_criteria",
      "public.stage_gate_reviews",
      "public.stage_gate_findings",
      "public.lifecycle_evaluations",
      "public.evidence_items",
      "public.disposal_records",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(asset_lifecycle_gate_reviews|asset_disposals)/,
    );
  });

  it("requires a named AAL2 human and independent asset evidence", () => {
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("v_role='ai_admin'");
    expect(migration).toContain("e.organization_id=v_org");
    expect(migration).toContain("e.asset_id=p_asset_id");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.verified_by<>v_actor");
    expect(migration).toContain("independently verified");
  });

  it("fails closed on incomplete criteria and stale or rejected evaluations", () => {
    expect(migration).toContain("every current-stage criterion exactly once");
    expect(migration).toContain("mandatory gate criteria must be met");
    expect(migration).toContain("decision='accepted'");
    expect(migration).toContain("evaluation asset and tenant");
    expect(migration).toContain("recommended");
    expect(migration).toContain("p_to_stage in ('life_extension','replacement')");
  });

  it("keeps review, movement and disposal as governed human acts", () => {
    expect(migration).toContain("app.gate_review_write");
    expect(migration).toContain("advance_lifecycle_stage");
    expect(migration).toContain("asset disposal records are rpc-only");
    expect(migration).toContain("app.asset_disposal_writer");
    expect(migration).toContain("expected version");
    expect(migration).toContain("operational_authority',false");
    expect(migration).toContain("financial_authority',false");
  });

  it("makes life extension, replacement and disposal customer reachable", () => {
    expect(service).toContain('"get_asset_lifecycle_gate_workspace"');
    expect(service).toContain('"record_asset_lifecycle_gate_review"');
    expect(service).toContain('"advance_lifecycle_stage"');
    expect(service).toContain('"record_asset_disposal"');
    expect(panel).toContain("Asset lifecycle gate workspace");
    expect(panel).toContain("Record gate review");
    expect(panel).toContain("Advance lifecycle stage");
    expect(panel).toContain("Record disposal and restoration");
    expect(host).toContain("<AssetLifecycleGateWorkspace />");
  });

  it("has authenticated clean-stack proof and closes only the owned rows", () => {
    for (const proof of [
      "tenant_wall=true",
      "aal2_required=true",
      "ai_operator_refused=true",
      "exact_criteria_coverage=true",
      "independent_verified_evidence=true",
      "accepted_evaluation_required=true",
      "direct_write_locked=true",
      "optimistic_disposal_version=true",
      "operational_authority=false",
      "financial_authority=false",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-asset-lifecycle-stage-gates-smoke.sh",
    );
    for (const id of ["U4.11", "U4.12", "U4.14"])
      expect(register).toMatch(new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`, "i"));
  });
});
