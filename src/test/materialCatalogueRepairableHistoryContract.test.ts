import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102070000_material_catalogue_repairable_history.sql",
  "utf8",
).toLowerCase();
const catalogue = readFileSync("src/components/MaterialCatalogue.tsx", "utf8");
const service = readFileSync(
  "src/services/repairableMaterialsService.ts",
  "utf8",
);
const lifecycle = readFileSync(
  "src/components/RepairableUnitRegister.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/MaterialsPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-material-catalogue-repairable-history-smoke.sh",
  "utf8",
);
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("C2.07 governed materials and serialized repairable history", () => {
  it("extends the canonical catalogue, BOM, stock and component models without duplicating them", () => {
    expect(migration).toContain("alter table public.materials");
    expect(migration).toContain("references public.materials(id)");
    expect(migration).toContain("references public.component_instances(id)");
    expect(migration).toContain("from public.material_stock");
    expect(migration).toContain("from public.bom_lines");
    expect(migration).not.toMatch(
      /create table if not exists public\.(materials|material_stock|bom_lines|work_order_materials)/,
    );
  });

  it("makes catalogue policy a versioned named-human act with explicit unknowns", () => {
    expect(migration).toContain("material_master_human_role_allowed");
    expect(migration).toContain("coalesce(up.role,'')<>'ai_admin'");
    expect(migration).toContain("master_version=p_expected_version");
    expect(migration).toContain("material_master_revisions");
    expect(migration).toContain("material master history is append-only");
    expect(migration).toContain("lead_time_days is null");
    expect(migration).toContain(
      "repairable classification is explicitly unknown",
    );
    expect(migration).toContain(
      "new.repairable_classification='unknown' and new.repairable",
    );
  });

  it("tracks one serialized rotable across installation, removal, repair and return", () => {
    expect(migration).toContain("repairable_units");
    expect(migration).toContain("repairable_unit_events");
    expect(migration).toContain("record_repairable_unit_event");
    expect(migration).toContain("component_instance_id");
    expect(migration).toContain("sent_for_repair");
    expect(migration).toContain("received_from_repair");
    expect(migration).toContain("installed");
    expect(migration).toContain("removed");
    expect(migration).toContain("scrapped");
  });

  it("enforces lifecycle order, tenant walls and evidence rather than inventing turnaround", () => {
    expect(migration).toContain("invalid repairable-unit transition");
    expect(migration).toContain("outside the active tenant");
    expect(migration).toContain("basis must be at least 20 characters");
    expect(migration).toContain("event time cannot precede");
    expect(migration).toContain("repair turnaround is not measurable");
    expect(migration).toContain("repairturnaroundhours");
    expect(migration).toContain("evidence_snapshot");
    expect(migration).toContain("masterversion");
    expect(migration).toContain("receipt supplier conflicts");
    expect(migration).toContain("null");
  });

  it("locks direct writes while retaining immutable receipts and audit evidence", () => {
    expect(migration).toContain(
      "revoke all on function public.capture_material_master_revision()",
    );
    expect(migration).toContain(
      "revoke all on function public.append_material_master_revision()",
    );
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.materials",
    );
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.repairable_units",
    );
    expect(migration).toContain("repairable unit events are append-only");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("is customer-operable from the materials workspace", () => {
    expect(catalogue).toContain("Lead time days");
    expect(catalogue).toContain("Repairable / rotable");
    expect(service).toContain('"get_repairable_unit_register"');
    expect(service).toContain('"record_repairable_unit_event"');
    expect(lifecycle).toContain("Serialized repairables");
    expect(parent).toContain("<RepairableUnitRegister");
  });

  it("has full-chain runtime proof before the capability is green", () => {
    for (const proof of [
      "named_human_only=true",
      "tenant_wall=true",
      "optimistic_catalogue=true",
      "legacy_repairable_compat=true",
      "direct_write_locked=true",
      "trigger_execute_locked=true",
      "serial_unique=true",
      "transition_order=true",
      "event_history=true",
      "turnaround_evidence=true",
      "unknown_visible=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-material-catalogue-repairable-history-smoke.sh",
    );
    expect(register).toMatch(/\| C2\.07 \|[^\n]+\| ✅[^\n]+/i);
  });
});
