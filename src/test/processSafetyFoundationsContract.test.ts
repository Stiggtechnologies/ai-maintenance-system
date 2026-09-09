import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219091000_process_safety_foundations.sql",
  "utf8",
);
const surface = readFileSync(
  "src/components/ProcessSafetyFoundations.tsx",
  "utf8",
);
const host = readFileSync("src/components/ProcessSafety.tsx", "utf8");
const riskPage = readFileSync("src/pages/RiskOperatingSystemPage.tsx", "utf8");
const assetSignals = readFileSync("src/pages/RiskConsequence.tsx", "utf8");

const WORKFLOWS = [
  "record_safety_critical_element",
  "record_major_hazard",
  "link_hazard_barrier",
  "record_integrity_window",
  "record_integrity_exceedance",
  "assess_integrity_exceedance",
] as const;

describe("process-safety foundations contract", () => {
  it("uses canonical safety stores and the canonical audit ledger", () => {
    for (const table of [
      "safety_critical_elements",
      "major_hazards",
      "hazard_barriers",
      "integrity_windows",
      "integrity_exceedances",
      "audit_events",
    ])
      expect(migration).toContain(table);
    expect(migration).not.toMatch(/create table/i);
  });

  it("refuses AI safety assertions and cross-tenant references", () => {
    expect(migration).toContain("coalesce(v_role,'')='ai_admin'");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("site is not in this organization");
    expect(migration).toContain(
      "hazard and barrier must belong to this organization",
    );
  });

  it("requires independent engineering assessment of exceedances", () => {
    expect(migration).toContain("v_uid,false,null");
    expect(migration).toContain("if v_recorder=v_uid");
    expect(migration).toContain("cannot independently assess it");
  });

  it("closes every privileged function to public and exposes every workflow in the UI", () => {
    for (const fn of WORKFLOWS) {
      expect(migration).toContain(`revoke all on function public.${fn}`);
      expect(migration).toContain(`grant execute on function public.${fn}`);
      expect(surface).toContain(fn);
    }
    expect(migration).toContain(
      "revoke all on function public.assert_safety_foundation_actor",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.assert_safety_foundation_actor/,
    );
  });

  it("mounts the authoring surface on the shipped Process Safety path", () => {
    expect(host).toContain(
      'import { ProcessSafetyFoundations } from "./ProcessSafetyFoundations"',
    );
    expect(host).toContain("<ProcessSafetyFoundations");
    expect(riskPage).toContain(
      'import { ProcessSafety } from "../components/ProcessSafety"',
    );
    expect(riskPage).toContain("<ProcessSafety");
    expect(assetSignals).toContain("<ProcessSafety");
  });
});
