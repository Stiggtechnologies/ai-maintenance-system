import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The industry pack tables (kpi_packs, industry_asset_libraries,
// industry_failure_mode_packs) each carry a *_count column, and SetupWizard and
// TemplateSelectorPage render it straight to the operator. The active schema has
// no pack-membership table, so no pack has members and no count is computable
// from any relation. Seeding a literal there is an attestation nothing earns.
//
// If pack membership is ever built, compute the count from it — do not restore a
// literal.
const MIGRATIONS = "supabase/migrations";
const seed = readFileSync(`${MIGRATIONS}/00000000000004_demo_seed.sql`, "utf8");

// Every migration, not just the one that happens to define the parent tables.
// Scoping this scan to `00000000000003_embed_relations.sql` would leave the
// control passing while its premise died: a membership table added by any LATER
// migration is exactly the change that should retire this whole test, and it
// would have gone unnoticed.
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => [f, readFileSync(`${MIGRATIONS}/${f}`, "utf8")] as const);

describe("industry pack counts are counted, not asserted", () => {
  it("has no pack-membership relation to count (control for the rule below)", () => {
    // Control: the parent tables really are defined somewhere in the chain, so
    // a scan that finds nothing is a real absence and not a broken glob.
    expect(
      migrations.filter(([, sql]) =>
        /create table if not exists industry_failure_mode_packs/i.test(sql),
      ).length,
      "control failed: the parent pack tables were not found in any migration",
    ).toBe(1);

    for (const items of [
      "kpi_pack_items",
      "industry_asset_library_items",
      "failure_mode_pack_items",
    ]) {
      // Match DDL, not the bare name: the seed explains in a comment why these
      // tables do not exist, and a substring scan would trip over that.
      const ddl = new RegExp(`create table (?:if not exists )?${items}\\b`, "i");
      const defining = migrations.filter(([, sql]) => ddl.test(sql)).map(([f]) => f);
      expect(
        defining,
        `${items} now exists (${defining.join(", ")}). Pack membership is real: ` +
          "compute the *_count columns from it and retire this test.",
      ).toHaveLength(0);
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
