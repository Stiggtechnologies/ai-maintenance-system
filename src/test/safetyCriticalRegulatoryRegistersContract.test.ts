import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102100000_safety_critical_regulatory_registers.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/safetyCriticalRegulatoryService.ts",
  "utf8",
);
const component = readFileSync(
  "src/components/SafetyCriticalRegulatoryRegister.tsx",
  "utf8",
);
const host = readFileSync("src/components/ProcessSafety.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-safety-critical-regulatory-registers-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C2.11 safety-critical equipment and regulatory obligations", () => {
  it("extends the canonical element, jurisdiction, evidence and audit models", () => {
    expect(migration).toContain("alter table public.safety_critical_elements");
    expect(migration).toContain("references public.capability_pack_layers(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(regulatory_obligations|safety_critical_equipment)/,
    );
  });

  it("freezes the exact element and adopted jurisdiction-layer versions", () => {
    expect(migration).toContain("safety_critical_element_version");
    expect(migration).toContain("capability_pack_layer_version");
    expect(migration).toContain("l.status='adopted'");
    expect(migration).toContain(
      "requirement_class' in ('regulatory','statutory')",
    );
    expect(component).toContain("stale: element is now");
  });

  it("requires a named AAL2 human and independently verified same-tenant evidence", () => {
    expect(migration).toContain("assert_safety_foundation_actor");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.verified_by<>v_actor");
    expect(migration).toContain("e.organization_id=v_org");
  });

  it("locks direct mutation and keeps compliance and operating authority false", () => {
    expect(migration).toContain("safety_critical_element_writer");
    expect(migration).toContain("safety_critical_obligation_writer");
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.safety_critical_elements",
    );
    for (const boundary of [
      "complianceEstablished",
      "workAuthorized",
      "riskAccepted",
      "operatingLimitChanged",
      "returnToServiceAuthorized",
    ]) {
      expect(service).toContain(boundary);
      expect(component).toContain(boundary);
    }
  });

  it("is customer reachable on the canonical Process Safety path", () => {
    expect(service).toContain('"get_safety_critical_regulatory_workspace"');
    expect(service).toContain('"record_safety_critical_element"');
    expect(service).toContain('"link_safety_critical_regulatory_obligation"');
    expect(host).toContain("<SafetyCriticalRegulatoryRegister");
  });

  it("has an authenticated full-chain runtime contract", () => {
    for (const proof of [
      "canonical_element_register=true",
      "canonical_jurisdiction_obligations=true",
      "aal2_required=true",
      "ai_operator_refused=true",
      "independent_verified_evidence=true",
      "tenant_wall=true",
      "optimistic_version=true",
      "exact_version_binding=true",
      "stale_binding_visible=true",
      "direct_write_locked=true",
      "compliance_established=false",
      "operational_authority=false",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-safety-critical-regulatory-registers-smoke.sh",
    );
  });
});
