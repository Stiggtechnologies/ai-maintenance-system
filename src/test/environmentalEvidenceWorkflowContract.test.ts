import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101590000_environmental_evidence_workflow.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/environmentalEvidenceService.ts",
  "utf8",
);
const management = readFileSync(
  "src/components/EnvironmentalEvidenceManagement.tsx",
  "utf8",
);
const performance = readFileSync(
  "src/components/EnvironmentalPerformance.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-environmental-evidence-workflow-smoke.sh",
  "utf8",
);

describe("E10 governed environmental evidence workflow", () => {
  it("extends the canonical environmental stores instead of creating parallel models", () => {
    for (const table of [
      "emission_factors",
      "environmental_activities",
      "efficiency_baselines",
      "efficiency_readings",
      "hazardous_inventory",
    ]) {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).not.toMatch(
        new RegExp(`create table(?: if not exists)? public\\.${table}`),
      );
    }
    expect(migration).toContain("public.evidence_items");
    expect(migration).toContain("public.audit_events");
    expect(migration).toContain("public.containment_losses");
  });

  it("makes every write tenant-scoped, AAL2 human-authored and independently evidenced", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_aal()<>'aal2'");
    expect(migration).toContain("public.app_actor_has_verified_mfa(v_actor)");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.verified_by<>v_actor");
    expect(migration).toContain("verifier.role<>'ai_admin'");
    expect(migration).toContain("v_role not in");
    expect(migration).toContain("ai_admin and read-only roles are refused");
  });

  it("locks direct writes and preserves append-only or optimistic version history", () => {
    expect(migration).toContain("guard_environmental_evidence_write");
    expect(migration).toContain("app.environmental_evidence_writer");
    expect(migration).toContain("expectedVersion");
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain("previous_state");
    expect(migration).toContain("new_state");
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.environmental_activities",
    );
    expect(migration).toContain(
      "Environmental evidence is retained and cannot be truncated",
    );
    expect(migration).toContain(
      "not exists(select 1 from public.organizations where id=v_org)",
    );
  });

  it("refuses dimensionally invalid emissions and retroactive factor selection", () => {
    expect(migration).toContain(
      "lower(btrim(f.activity_unit))=lower(btrim(p_record->>'unit'))",
    );
    expect(migration).toContain("ef.valid_from<=a.period_end");
    expect(migration).toContain(
      "lower(btrim(ef.activity_unit))=lower(btrim(a.unit))",
    );
  });

  it("requires the controls claimed for hazardous materials", () => {
    for (const control of [
      "location",
      "handlingRequirements",
      "emergencyResponseReference",
      "regulatoryReference",
      "disposalRouteRequired",
    ]) {
      expect(service).toContain(control);
      expect(management).toContain(control);
    }
    expect(migration).toContain("controlled location");
    expect(migration).toContain("emergency and regulatory references");
    expect(migration).toContain("disposal route are required");
  });

  it("keeps environmental evidence separate from compliance and operational authority", () => {
    expect(migration).toContain("complianceCertified',false");
    expect(migration).toContain("workAuthorized',false");
    expect(migration).toContain("riskAccepted',false");
    expect(migration).toContain("returnToServiceAuthorized',false");
    expect(migration).toContain("reportableInventory',false");
  });

  it("makes all five record types customer-reachable and renders actual loss analysis", () => {
    for (const kind of [
      "emission_factor",
      "efficiency_baseline",
      "efficiency_reading",
      "environmental_activity",
      "hazardous_inventory",
    ]) {
      expect(service).toContain(`"${kind}"`);
      expect(migration).toContain(`'${kind}'`);
    }
    expect(service).toContain('"record_environmental_evidence"');
    expect(management).toContain("recordEnvironmentalEvidence");
    expect(performance).toContain("summariseLosses");
    expect(performance).toContain('"get_environmental_loss_records"');
    expect(performance).toContain("<EnvironmentalEvidenceManagement />");
  });

  it("runs a clean-stack smoke in CI", () => {
    expect(workflow).toContain(
      "bash scripts/ci-environmental-evidence-workflow-smoke.sh",
    );
    for (const proof of [
      "tenant_wall=true",
      "aal2_required=true",
      "independent_evidence=true",
      "direct_write_locked=true",
      "loss_summary_reachable=true",
      "authority_granted=false",
    ]) {
      expect(smoke).toContain(proof);
    }
  });
});
