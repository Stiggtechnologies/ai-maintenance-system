import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219092000_pressure_integrity_activation.sql",
  "utf8",
);
const surface = readFileSync("src/components/PressureIntegrity.tsx", "utf8");
const host = readFileSync("src/components/ProcessSafety.tsx", "utf8");

describe("pressure integrity activation contract", () => {
  it("extends canonical stores and audit ledger without a parallel table", () => {
    for (const name of [
      "corrosion_circuits",
      "thickness_readings",
      "audit_events",
    ])
      expect(migration).toContain(name);
    expect(migration).not.toMatch(/create table/i);
  });
  it("requires owner evidence and refuses invented limits", () => {
    expect(migration).toContain(
      "owner-approved minimum thickness is required; SyncAI does not invent it",
    );
    expect(migration).toContain("evidence basis are required");
    expect(surface).toMatch(/owner-approved\s+limits/);
  });
  it("tenant-scopes authoring and assessment", () => {
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("assert_safety_foundation_actor");
    expect(migration).toContain(
      "authenticated organization membership is required",
    );
  });
  it("uses the governed formula and blocks unsupported calculations", () => {
    expect(migration).toContain("(v_previous-v_current)/v_years");
    expect(migration).toContain("(v_current-v_min)/v_rate");
    expect(migration).toContain("two readings on different dates are required");
    expect(migration).toContain("no_positive_metal_loss");
    expect(migration).toContain("at_or_below_minimum");
  });
  it("closes privileged doors and mounts every workflow", () => {
    for (const fn of [
      "record_corrosion_circuit",
      "record_thickness_reading",
      "assess_corrosion_circuit",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}`);
      expect(migration).toContain(`grant execute on function public.${fn}`);
      expect(surface).toContain(fn);
    }
    expect(host).toContain("<PressureIntegrity");
  });
});
