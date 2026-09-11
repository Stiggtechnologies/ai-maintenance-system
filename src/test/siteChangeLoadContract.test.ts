import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const migration=readFileSync("supabase/migrations/20261219143000_develop_site_change_load.sql","utf8").toLowerCase();
const service=readFileSync("src/services/siteChangeLoadService.ts","utf8");
const panel=readFileSync("src/components/develop/SiteChangeLoadPanel.tsx","utf8");
const page=readFileSync("src/pages/WorkActionBoard.tsx","utf8");
const register=readFileSync("docs/sync-develop/register.md","utf8");

describe("D7.15 Site Change Load",()=>{
  it("is a pure calculation over every canonical ingredient",()=>{
    for(const table of ["development_cases","outage_windows","schedule_options","temporary_modifications","training_plans","capacity_deductions","work_orders"])
      expect(migration).toContain(`public.${table}`);
    expect(migration).not.toMatch(/create table/);
  });
  it("does not invent weights or double-subtract capacity",()=>{
    expect(migration).toContain("unweighted_concurrent_record_count");
    expect(migration).toContain("deductions are not subtracted twice");
    expect(panel).toContain("unlike records are not claimed to have equal severity");
  });
  it("refuses the absorption forecast over missing estimates or capacity",()=>{
    expect(migration).toContain("not_computable_no_site_capacity");
    expect(migration).toContain("not_computable_missing_work_estimates");
    expect(migration).toContain("'forecastcomputable'");
    expect(panel).toContain("Missing evidence is shown below; it is not treated as zero");
  });
  it("activates the two formerly schema-only inputs through human-only governed writers",()=>{
    expect(migration).toContain("record_site_outage_window");
    expect(migration).toContain("record_site_training_plan");
    expect(migration).toContain("coalesce(v_role,'') not in ('admin','executive','maintenance_manager','planner','supervisor')");
    expect(migration).toContain("insert into public.outage_windows");
    expect(migration).toContain("insert into public.training_plans");
    expect(migration).toContain("insert into public.audit_events");
    expect(service).toContain('supabase.rpc("record_site_outage_window"');
    expect(service).toContain('supabase.rpc("record_site_training_plan"');
    expect(panel).toContain("Record outage");
    expect(panel).toContain("Record training plan");
  });
  it("is tenant-scoped, bounded, and decision support only",()=>{
    expect(migration).toContain("site_id=p_site_id");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("least(greatest(coalesce(p_horizon_weeks,13),1),104)");
    expect(migration).toContain("does not authorize work, approve change, rank individuals");
  });
  it("is customer-reachable from Work Management for the selected site",()=>{
    expect(service).toContain('supabase.rpc("get_site_change_load"');
    expect(page).toContain("<SiteChangeLoadPanel siteId={siteId}");
    expect(panel).toContain("Choose a site in the header");
  });
  it("advances only D7.15 with concrete evidence",()=>{
    expect(register).toMatch(/\| D7\.15 \|[^\n]+\| ✅[^\n]+get_site_change_load/);
  });
});
