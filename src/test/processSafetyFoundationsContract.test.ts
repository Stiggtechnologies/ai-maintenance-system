import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261219091000_process_safety_foundations.sql", "utf8");
const surface = readFileSync("src/components/ProcessSafetyFoundations.tsx", "utf8");

describe("process-safety foundations contract", () => {
  it("uses canonical safety stores and the canonical audit ledger", () => {
    for (const table of ["safety_critical_elements", "major_hazards", "hazard_barriers", "integrity_windows", "integrity_exceedances", "audit_events"]) expect(migration).toContain(table);
    expect(migration).not.toMatch(/create table/i);
  });

  it("refuses AI safety assertions and cross-tenant references", () => {
    expect(migration).toContain("coalesce(v_role,'')='ai_admin'");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("site is not in this organization");
    expect(migration).toContain("hazard and barrier must belong to this organization");
  });

  it("requires independent engineering assessment of exceedances", () => {
    expect(migration).toContain("v_uid,false,null");
    expect(migration).toContain("if v_recorder=v_uid");
    expect(migration).toContain("cannot independently assess it");
  });

  it("closes every privileged function to public and exposes every workflow in the UI", () => {
    for (const fn of ["record_safety_critical_element", "record_major_hazard", "link_hazard_barrier", "record_integrity_window", "record_integrity_exceedance", "assess_integrity_exceedance"]) {
      expect(migration).toContain(`revoke all on function public.${fn}`);
      expect(surface).toContain(fn);
    }
  });
});
