import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const sql = stripComments(
  readFileSync(
    "supabase/migrations/20261225170000_material_commercial_feedback.sql",
    "utf8",
  ),
);

describe("material commercial feedback migration contract", () => {
  it("extends the canonical reverse traversal without a top-N cutoff", () => {
    expect(sql).toContain(
      "create or replace function public.get_design_feedback_loop()",
    );
    expect(sql).not.toMatch(/\blimit\s+\d+/i);
    expect(sql).toContain("order by m.n desc, m.fm");
    expect(sql).not.toMatch(/create\s+table/i);
  });

  it("retains invoker security and organization filters on both canonical sources", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("w.organization_id = app_current_org()");
    expect(sql.match(/d\.organization_id = app_current_org\(\)/g)).toHaveLength(
      2,
    );
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });

  it("keeps failure counts separate from requirement-reference counts", () => {
    expect(sql).toContain("w.work_type = 'corrective'");
    expect(sql).toContain("count(distinct w.asset_id)::bigint assets");
    expect(sql).toContain("d.derived_from_failure_mode = m.fm");
    expect(sql).toContain("requirements_referencing bigint");
    expect(sql).toContain("loop_closed boolean");
  });
});
