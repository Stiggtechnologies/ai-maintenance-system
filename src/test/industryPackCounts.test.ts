import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDUSTRY_TEMPLATE_PACKS } from "../lib/industry-template-packs";

const seed = readFileSync(
  "supabase/migrations/00000000000004_demo_seed.sql",
  "utf8",
);
const membershipPath =
  "supabase/migrations/20261002091000_industry_pack_membership.sql";
const membership = [
  readFileSync(membershipPath, "utf8"),
  readFileSync(
    "supabase/migrations/20261219139000_battery_energy_storage_pack.sql",
    "utf8",
  ),
  readFileSync(
    "supabase/migrations/20261219230000_healthcare_pack.sql",
    "utf8",
  ),
  readFileSync(
    "supabase/migrations/20261219240000_civil_infrastructure_pack.sql",
    "utf8",
  ),
].join("\n");
const coverage = readFileSync("docs/industry-pack-coverage.md", "utf8");

describe("industry pack counts are counted, not asserted", () => {
  it("creates relational membership and derives all three displayed counts", () => {
    for (const table of [
      "kpi_pack_items",
      "industry_asset_library_items",
      "failure_mode_pack_items",
    ]) {
      expect(membership).toContain(
        `create table if not exists public.${table}`,
      );
      expect(membership).toContain(
        `alter table public.${table} enable row level security`,
      );
    }

    expect(membership).toContain(
      "set kpi_count = (select count(*) from public.kpi_pack_items",
    );
    expect(membership).toContain(
      "set asset_class_count = (select count(*) from public.industry_asset_library_items",
    );
    expect(membership).toContain(
      "set failure_mode_count = (select count(*) from public.failure_mode_pack_items",
    );
    expect(membership).toContain("trg_sync_kpi_pack_count");
    expect(membership).toContain("trg_sync_asset_library_count");
    expect(membership).toContain("trg_sync_failure_mode_pack_count");
  });

  it("represents every canonical pack and every member in the migration", () => {
    for (const pack of Object.values(INDUSTRY_TEMPLATE_PACKS)) {
      const escapedName = pack.industryName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      expect(coverage).toMatch(new RegExp(`\\|\\s*${escapedName}\\s*\\|`));
      expect(membership).toContain(
        `src/lib/industry-template-packs.ts#${pack.industryCode}`,
      );
      for (const label of [
        ...pack.kpiModel.primaryKpis,
        ...pack.kpiModel.secondaryKpis,
        ...pack.commonAssetClasses,
        ...pack.failureModeFocusAreas,
      ]) {
        expect(membership, `${pack.industryCode}: ${label}`).toContain(
          label.replaceAll("'", "''"),
        );
      }
    }
  });

  it("removes the old unearned literals and fixes blanket Oil Sands bindings", () => {
    for (const column of [
      "kpi_count",
      "asset_class_count",
      "failure_mode_count",
    ]) {
      const seeded = new RegExp(
        `insert into [a-z_]+\\s*\\([^)]*\\b${column}\\b`,
        "i",
      );
      expect(seed).not.toMatch(seeded);
    }

    expect(membership).toContain(
      "('oil-sands','oil_sands'), ('mining','mining')",
    );
    expect(membership).toContain(
      "('manufacturing','manufacturing'), ('power','power_generation')",
    );
    expect(membership).toContain("where d.slug = b.slug");
  });
});
