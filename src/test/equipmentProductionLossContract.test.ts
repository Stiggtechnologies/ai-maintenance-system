import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271110130000_equipment_production_loss.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/opsCoordinationService.ts", "utf8");
const panel = readFileSync("src/components/OpsCoordination.tsx", "utf8");
const parent = readFileSync("src/pages/HandoverPage.tsx", "utf8");

describe("C6.04 equipment-attributable production loss", () => {
  it("keeps the canonical reader and refuses a second loss ledger", () => {
    expect(migration).toContain(
      "create or replace function public.get_production_loss",
    );
    expect(migration).not.toMatch(
      /create table if not exists public\.(production_losses|equipment_production_loss)/,
    );
    expect(migration).toContain("from public.operating_states");
    expect(migration).toContain("from public.production_records");
    expect(migration).toContain("from public.downtime_classification_reviews");
    expect(migration).toContain("where d.classification = 'equipment_failure'");
    expect(migration).toContain("coalesce(lr.classification, 'unclassified')");
    expect(migration).toContain("c.classification <> 'equipment_failure'");
  });

  it("unions overlapping hours and uses only a single demonstrated rate", () => {
    expect(migration).toContain("range_agg(tstzrange(");
    expect(migration).toContain("unnest(");
    expect(migration).toContain("p.units / nullif(r.hours, 0)");
    expect(migration).toContain("p.unit_count = 1");
    expect(migration).toContain("nameplate capacity is not used");
    expect(migration).not.toContain("nameplate_capacity");
    expect(migration).toContain("unlike units are not added");
  });

  it("stays inside the caller tenant and audits a named-human receipt only", () => {
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("os.organization_id = v_org");
    expect(migration).toContain("p.organization_id = v_org");
    expect(migration).toContain("d.organization_id = v_org");
    expect(migration).toContain("s.organization_id = v_org");
    expect(migration).toContain("a.organization_id = v_org");
    expect(migration).toContain("production_loss_human_role_allowed()");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'production_value_authorized', false");
    expect(migration).toContain("'work_released', false");
    expect(migration).toContain("'risk_accepted', false");
    expect(migration).toContain("'return_to_service_authorized', false");
    expect(migration).toContain(
      "revoke all on function public.record_equipment_production_loss_receipt(int)",
    );
    expect(migration).toContain(
      "grant execute on function public.record_equipment_production_loss_receipt(int)",
    );
  });

  it("is reachable from the existing handover surface", () => {
    expect(service).toContain('"get_ops_coordination"');
    expect(service).toContain('"record_equipment_production_loss_receipt"');
    expect(panel).toContain("recordEquipmentProductionLossReceipt");
    expect(panel).toContain("Enterprise total");
    expect(panel).toContain("Record measurement receipt");
    expect(panel).toContain("These units are not added together.");
    expect(parent).toContain("<OpsCoordination />");
  });
});
