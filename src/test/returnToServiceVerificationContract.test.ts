import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("C5.21 governed return-to-service verification", () => {
  const sql = read(
    "supabase/migrations/20270101460000_return_to_service_verification.sql",
  );

  it("extends the canonical equipment handback and quality acceptance models", () => {
    expect(sql).toContain("alter table public.equipment_releases");
    expect(sql).toContain("acceptance_test_id");
    expect(sql).toContain("references public.acceptance_tests(id)");
    expect(sql).not.toMatch(
      /create\s+table[^;]+(return.?to.?service|equipment.?accept|verification.?queue)/i,
    );
  });

  it("requires a released return-to-service test with verified same-asset evidence", () => {
    expect(sql).toContain("verify_and_accept_equipment");
    expect(sql).toContain("test_stage = 'return_to_service'");
    expect(sql).toContain("release_status = 'released'");
    expect(sql).toContain("outcome = 'pass'");
    expect(sql).toContain("punch_items_open = 0");
    expect(sql).toContain("verification_status = 'verified'");
    expect(sql).toContain("e.asset_id = r.asset_id");
    expect(sql).toContain("candidate.released_at >= r.returned_at");
    expect(sql).toContain("idx_equipment_release_one_use_rts_test");
  });

  it("keeps return-to-service a named-human operations act with separation of duties", () => {
    expect(sql).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/i);
    expect(sql).toContain("('operator','executive','admin')");
    expect(sql).toContain("r.returned_by = v_actor");
    expect(sql).toContain("t.performed_by = v_actor");
    expect(sql).toContain("t.released_by = v_actor");
    expect(sql).toContain("quality_control_role(v_releaser_role)");
    expect(sql).toContain("performer.id <> releaser.id");
    expect(sql).toContain("releaser.id <> auth.uid()");
    expect(sql).toContain("accepted_by = v_actor");
    expect(sql).toContain("verified_by = v_actor");
  });

  it("hardens both custody handoffs without granting AI or cross-tenant authority", () => {
    expect(sql).toContain(
      "create or replace function public.release_equipment",
    );
    expect(sql).toContain("create or replace function public.return_equipment");
    expect(sql).toContain("same-tenant asset not found");
    expect(sql).toContain(
      "the work order must belong to this tenant and asset",
    );
    expect(sql).toContain(
      "the AI-operator identity cannot release equipment custody",
    );
    expect(sql).toContain(
      "the AI-operator identity cannot attest a maintenance handback",
    );
  });

  it("closes the legacy and direct-write bypasses and writes canonical audit provenance", () => {
    expect(sql).toContain("app.return_to_service_write");
    expect(sql).toMatch(
      /create\s+trigger\s+trg_equipment_release_rts_provenance/i,
    );
    expect(sql).toMatch(/before\s+insert\s+or\s+update/i);
    expect(sql).toContain("revoke all on function public.accept_equipment");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("verification_sha256");
  });

  it("is reachable from the existing handover surface through one typed service", () => {
    const component = read("src/components/OpsCoordination.tsx");
    const service = read("src/services/opsCoordinationService.ts");

    expect(component).toContain("verifyAndAcceptEquipment");
    expect(component).toContain("eligible_rts_tests");
    expect(component).toContain("Quality assurance");
    expect(service).toContain('"get_ops_coordination"');
    expect(service).toContain('"verify_and_accept_equipment"');
  });
});
