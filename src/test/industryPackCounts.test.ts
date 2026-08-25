import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The industry pack tables (kpi_packs, industry_asset_libraries,
// industry_failure_mode_packs) each carry a *_count column, and SetupWizard and
// TemplateSelectorPage render it straight to the operator. The active schema has
// no pack-membership table, so no pack has members and no count is computable
// from any relation. Seeding a literal there is an attestation nothing earns.
//
// If pack membership is ever built, compute the count from it — do not restore a
// literal.
const seed = readFileSync("supabase/migrations/00000000000004_demo_seed.sql", "utf8");
const schema = readFileSync("supabase/migrations/00000000000003_embed_relations.sql", "utf8");

describe("industry pack counts are counted, not asserted", () => {
  it("has no pack-membership relation to count (control for the rule below)", () => {
    // Control: the parent tables really are defined in this file.
    expect(schema).toContain("create table if not exists industry_failure_mode_packs");
    for (const items of [
      "kpi_pack_items",
      "industry_asset_library_items",
      "failure_mode_pack_items",
    ]) {
      expect(schema).not.toContain(items);
    }
  });

  it("never seeds a hardcoded pack count", () => {
    for (const column of ["kpi_count", "asset_class_count", "failure_mode_count"]) {
      const seeded = new RegExp(`insert into [a-z_]+\\s*\\([^)]*\\b${column}\\b`, "i");
      expect(
        seed,
        `${column} is seeded with a literal. Nothing counts it: there is no pack-membership ` +
          "table in the active schema. Compute it from real membership or do not assert it.",
      ).not.toMatch(seeded);
    }
  });
});
