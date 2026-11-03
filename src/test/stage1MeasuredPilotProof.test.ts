import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INGEST_ENTITIES } from "../lib/ingest-entities";

const sql = readFileSync(
  "supabase/migrations/20271103150000_stage1_measured_pilot_proof.sql",
  "utf8",
);

describe("Stage-1 measured pilot proof", () => {
  it("reuses the canonical measures and adds no parallel store", () => {
    expect(sql).toContain("get_work_management_health");
    expect(sql).toContain("get_repeat_failure_metrics");
    expect(sql).toContain("from public.operating_states");
    expect(sql).toContain("from public.production_records");
    expect(sql).toContain("from public.work_order_materials");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toContain("parts_ready");
    expect(sql).not.toMatch(/26317|32,394|AHS/);
  });

  it("measures emergency work only from a source response class", () => {
    expect(sql).toContain("emergency_work_pct");
    expect(sql).toContain("->>'measured'");
    expect(sql).toContain(
      "Emergency work counts only work orders whose source dispatch class is emergency",
    );
    expect(sql).not.toMatch(/priority\s*=\s*'critical'/);
  });

  it("withholds availability on overlap and refuses nameplate or mixed-unit totals", () => {
    expect(sql).toContain("r.covered && d.covered");
    expect(sql).toContain("The ratio is withheld");
    expect(sql).toContain("Nameplate capacity is refused");
    expect(sql).toContain("Mixed units are not summed");
    expect(sql).toContain("count(distinct p.unit_of_measure)");
    expect(sql).toContain("historical_fleet_studies_used', false");
  });

  it("keeps backlog planning and material readiness separate", () => {
    expect(sql).toContain("planning_complete_pct");
    expect(sql).toContain("materials_ready_pct");
    expect(sql).toContain("The two percentages stay separate");
    expect(sql).toContain("An empty backlog is not a perfect score");
    expect(sql).not.toContain("quality_score");
  });

  it("binds both functions to the caller tenant and a named human", () => {
    expect(sql).toContain("v_org uuid := public.app_current_org()");
    expect(sql).toContain("if auth.uid() is null or v_org is null");
    expect(sql).toContain("if v_role = 'ai_admin'");
    expect(sql).toContain(
      "the AI operator cannot classify emergency work",
    );
    expect(sql).not.toMatch(/p_organization_id|p_org\b/);
    expect(sql).toContain("insert into public.audit_events");
  });

  it("revokes anon and service_role and grants only authenticated", () => {
    expect(sql).toMatch(
      /revoke all on function public\.get_stage1_measured_pilot_proof\(int\)\s+from public, anon, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_stage1_measured_pilot_proof\(int\)\s+to authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.apply_imported_work_order_response_class\(uuid\)\s+from public, anon, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_imported_work_order_response_class\(uuid\)\s+to authenticated/,
    );
  });

  it("copies response_class from the work-order file and leaves the sample class blank", () => {
    const entity = INGEST_ENTITIES.work_order;
    const response = entity.columns.find((col) => col.name === "response_class");
    expect(response?.oneOf).toEqual(["emergency", "urgent", "scheduled"]);
    expect(response?.required).toBeUndefined();
    for (const row of entity.templateRows) {
      expect(row).toHaveLength(entity.columns.length);
      expect(row[row.length - 1]).toBe("");
    }
    expect(sql).toContain("payload->>'response_class'");
    expect(sql).toContain(
      "w.response_class is null or w.response_class = staged.class",
    );
  });
});
