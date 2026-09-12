import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import {
  RECORDABLE_VALUE_TRAJECTORY_POINTS,
  VALUE_LEAKAGE_BUCKETS,
  VALUE_TRAJECTORY_POINTS,
} from "../lib/develop/realize";

const FILE = "20261219159000_develop_value_leakage_benefits.sql";
const sql = stripComments(readFileSync(`supabase/migrations/${FILE}`, "utf8"));

describe("value leakage and benefits migration contract", () => {
  it("extends the canonical value store instead of adding a parallel one", () => {
    expect(sql).toContain("alter table public.value_metrics");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).toContain("development_baselines");
    expect(sql).toContain("evidence_items");
    expect(sql).toContain("audit_events");
  });

  it("pins all six points and seven buckets in SQL and TypeScript", () => {
    for (const point of VALUE_TRAJECTORY_POINTS)
      expect(sql).toContain(`'${point}'`);
    for (const point of RECORDABLE_VALUE_TRAJECTORY_POINTS)
      expect(sql).toContain(`'${point}'`);
    for (const bucket of VALUE_LEAKAGE_BUCKETS)
      expect(sql).toContain(`'${bucket}'`);
  });

  it("uses the one verifier with author separation and table-wall markers", () => {
    expect(sql).toContain(
      "create or replace function public.verify_value_metric(",
    );
    expect(sql).toContain("m.recorded_by=auth.uid()");
    expect(sql).toContain("author cannot perform its independent verification");
    expect(sql).toContain("app.value_leakage_record_write");
    expect(sql).toContain("app.value_leakage_verify_write");
    expect(sql).toContain("before insert or update or delete");
  });

  it("keeps missing, mixed, over-attributed and residual states explicit", () => {
    const read = sql.slice(
      sql.indexOf("create or replace function public.get_case_value_leakage("),
    );
    expect(read).toContain("mixed units");
    expect(read).toContain("'missingPoints'");
    expect(read).toContain("'unattributedResidual'");
    expect(read).toContain("'attributionValid'");
    expect(read).toContain("'decisionBoundary'");
    expect(read).not.toMatch(/greatest\s*\(\s*v_leakage/i);
  });

  it("has a per-benefit expected/forecast/actual/variance read", () => {
    expect(sql).toContain(
      "create or replace function public.get_case_benefits_screen(",
    );
    expect(sql).toContain("'currentForecast'");
    expect(sql).toContain("'actual'");
    expect(sql).toContain("'variance'");
    expect(sql).toContain("get_case_value_leakage(p_case_id)");
  });
});
