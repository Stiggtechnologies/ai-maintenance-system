import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/services/pilotIntake.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260920003000_ria_governed_write_contracts.sql",
  "utf8",
).toLowerCase();

describe("RIA commercial activation schema contract", () => {
  it("maps the canonical persisted acceptance field without degrading the activation read", () => {
    expect(service).toContain(
      "commercial_acceptance_reference:activation_acceptance_reference",
    );
    expect(migration).toContain(
      "add column if not exists activation_acceptance_reference text",
    );
    expect(migration).toContain(
      "activation_acceptance_reference = btrim(p_acceptance_reference)",
    );
  });
});
