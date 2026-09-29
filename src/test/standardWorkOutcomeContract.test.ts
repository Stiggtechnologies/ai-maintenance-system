import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migration = stripComments(readFileSync(
  "supabase/migrations/20261231100000_standard_work_outcome_contract.sql",
  "utf8",
));
const lower = migration.toLowerCase();
const service = readFileSync("src/services/developService.ts", "utf8");
const form = readFileSync("src/components/develop/StandardWorkObservationForm.tsx", "utf8");
const panel = readFileSync("src/components/develop/StandardWorkLearningPanel.tsx", "utf8");

function functionBody(name: string): string {
  const start = lower.indexOf(`create or replace function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = lower.indexOf("create or replace function public.", start + 10);
  return lower.slice(start, next === -1 ? lower.length : next);
}

describe("D9.06 outcome and attribution contract", () => {
  it("preserves existing observation text without inventing a measurement", () => {
    expect(lower).toContain("set standard_outcome_kind='qualitative'");
    expect(lower).toContain("standard_outcome_attribution_limit=standard_outcome_description");
    expect(lower).toContain("disable trigger standard_work_observation_guard");
    expect(lower).toContain("enable trigger standard_work_observation_guard");
  });

  it("requires kind and attribution limits for every observation", () => {
    expect(lower).toContain("standard_work_observation_outcome_contract");
    expect(lower).toContain("standard_outcome_kind in ('qualitative','quantitative')");
    expect(lower).toContain("length(btrim(standard_outcome_attribution_limit)) between 10 and 10000");
    expect(lower).toContain("standard_outcome_kind is null and standard_outcome_value is null");
  });

  it("requires finite quantitative values with units and refuses numbers on qualitative claims", () => {
    expect(lower).toContain("standard_outcome_value not in ('nan'::numeric,'infinity'::numeric,'-infinity'::numeric)");
    expect(lower).toContain("length(btrim(standard_outcome_unit)) between 1 and 120");
    expect(lower).toContain("standard_outcome_value is null and standard_outcome_unit is null");
    const recorder = functionBody("record_standard_work_observation");
    expect(recorder).toContain("jsonb_typeof(p_observation->'outcomevalue') is distinct from 'number'");
    expect(recorder).toContain("qualitative outcomes cannot carry a numeric value or unit");
    expect(recorder).toContain("'improvementestablished',false");
  });

  it("carries the contract through the customer write and read surfaces", () => {
    for (const field of [
      "standard_outcome_kind",
      "standard_outcome_value",
      "standard_outcome_unit",
      "standard_outcome_attribution_limit",
    ]) expect(service).toContain(field);
    expect(form).toContain("Outcome representation");
    expect(form).toContain("Attribution limits");
    expect(form).toContain("Outcome value");
    expect(form).toContain("Outcome unit");
    expect(panel).toContain("Outcome representation");
    expect(panel).toContain("Attribution limits");
  });

  it("keeps the RPC unavailable to anonymous and service roles", () => {
    expect(lower).toMatch(/revoke all on function public\.record_standard_work_observation\([^)]*\)\s+from public,anon,service_role/);
    expect(lower).toMatch(/grant execute on function public\.record_standard_work_observation\([^)]*\)\s+to authenticated/);
  });
});
