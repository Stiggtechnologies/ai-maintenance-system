import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219310000_configuration_management_activation.sql",
  "utf8",
).toLowerCase();
const surface = readFileSync(
  "src/components/ConfigurationAuthoring.tsx",
  "utf8",
);

describe("U7 configuration management activation", () => {
  it("writes the canonical configuration objects rather than parallel stores", () => {
    for (const table of [
      "configuration_baselines",
      "configuration_items",
      "approved_substitutions",
      "red_line_markups",
      "model_variants",
      "interchangeability_rules",
      "configuration_reconciliations",
    ])
      expect(sql).toContain(`public.${table}`);
    expect(sql).not.toContain("create table");
  });

  it("enforces tenancy, evidence, change references and independent approval", () => {
    expect(sql).toContain("asset not found in this tenant");
    expect(sql).toContain("reviewable evidence basis is required");
    expect(sql).toContain("engineering change reference");
    expect(sql).toContain("the proposer cannot approve their own");
    expect(sql).toContain("the author cannot close their own red-line");
    expect(sql).toContain("insert into public.approvals");
    expect(sql).toContain("insert into public.audit_events");
  });

  it("denies anonymous RPC execution and exposes every workflow in the product", () => {
    for (const fn of [
      "get_configuration_authoring_workspace()",
      "record_configuration_baseline(jsonb)",
      "record_model_variant(jsonb)",
      "propose_configuration_authority(text,jsonb)",
      "decide_configuration_authority(text,bigint,text,text)",
      "record_red_line(jsonb)",
      "dispose_red_line(bigint,text,text,text)",
      "record_configuration_reconciliation(jsonb)",
    ])
      expect(sql).toContain(
        `revoke all on function public.${fn} from public,anon`,
      );
    for (const mode of [
      "baseline",
      "variant",
      "substitution",
      "interchangeability",
      "red_line",
      "reconciliation",
    ])
      expect(surface).toContain(`value="${mode}"`);
  });

  it("keeps every output non-executing", () => {
    expect(sql).toContain("no equipment change authorized");
    expect(sql).toContain("observation only");
    expect(sql).toContain("it cannot execute a configuration change");
  });
});
