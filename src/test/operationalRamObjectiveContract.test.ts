import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102340000_operational_ram_objectives.sql",
  "utf8",
).toLowerCase();
const normalizedMigration = migration.replace(/\s+/g, " ");
const smoke = readFileSync(
  "scripts/ci-operational-ram-objectives-smoke.sh",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/ReliabilityByDesignPage.tsx", "utf8");

describe("C8.02 operational requirement to RAM and lifecycle objectives", () => {
  it("extends canonical records instead of creating parallel requirement or objective stores", () => {
    expect(migration).toContain("alter table public.ram_targets");
    expect(normalizedMigration).toContain(
      "source_requirement_id bigint references public.design_requirements(id)",
    );
    expect(normalizedMigration).toContain(
      "objective_id uuid references public.risk_objectives(id)",
    );
    expect(normalizedMigration).toContain(
      "lifecycle_plan_id uuid references public.asset_lifecycle_plans(id)",
    );
    expect(normalizedMigration).toContain(
      "operating_kpi_key text references public.kpi_catalog(kpi_key)",
    );
    expect(migration).not.toContain(
      "create table public.operational_requirement",
    );
    expect(migration).not.toContain(
      "create table if not exists public.operational_requirement",
    );
  });

  it("requires all three RAM dimensions and refuses invented or unitless targets", () => {
    expect(migration).toContain("target_availability");
    expect(migration).toContain("reliability_target");
    expect(migration).toContain("maintainability_target");
    expect(migration).toContain("maintainability_measure");
    expect(migration).toContain(
      "ram targets must be supplied by a named human",
    );
    expect(migration).toContain(
      "a reliability target requires a positive value and unit",
    );
    expect(migration).toContain(
      "a maintainability target requires a positive value, unit and stated measure",
    );
  });

  it("binds exact adopted objectives, latest lifecycle plans, KPI and verified evidence", () => {
    expect(migration).toContain("o.status='adopted'");
    expect(migration).toContain(
      "d.objective_id is distinct from new.objective_id",
    );
    expect(migration).toContain(
      "d.operating_kpi_key is distinct from new.operating_kpi_key",
    );
    expect(migration).toContain("lp.asset_id=d.satisfied_by_asset_id");
    expect(migration).toContain("newer.version>l.version");
    expect(migration).toContain("ei.verification_status='verified'");
    expect(migration).toContain("public.can_read_risk(e.risk_id)");
  });

  it("enforces independent named-human review, immutability and supersession", () => {
    expect(migration).toContain(
      "segregation of duties requires an independent ram-objective reviewer",
    );
    expect(migration).toContain(
      "translated ram targets are changed only through the governed conversion workflow",
    );
    expect(migration).toContain("translation content is immutable");
    expect(migration).toContain("translation_status='superseded'");
    expect(migration).toContain("translation_snapshot");
  });

  it("keeps conversion outside operational and financial authority", () => {
    for (const marker of [
      "'maychangework',false",
      "'mayapprove',false",
      "'mayacceptrisk',false",
      "'maycommitspend',false",
      "'maychangeoperatinglimits',false",
      "'mayreturntoservice',false",
    ]) {
      expect(migration).toContain(marker);
    }
    expect(smoke).toContain("no_operational_authority=true");
  });

  it("is reachable from the customer Reliability by Design surface", () => {
    expect(page).toContain("OperationalObjectivesWorkbench");
    expect(page).toContain("<OperationalObjectivesWorkbench />");
  });
});
