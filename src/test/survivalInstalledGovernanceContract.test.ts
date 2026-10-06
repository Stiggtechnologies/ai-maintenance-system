import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270103000000_governed_installed_survival.sql",
  "utf8",
).toLowerCase();
const smoke = readFileSync("scripts/ci-survival-covariate-smoke.sh", "utf8");
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);

describe("canonical installed-life survival governance", () => {
  it("extends canonical installations rather than creating a second life or approval store", () => {
    expect(sql).toContain("alter table public.component_instances");
    expect(sql).not.toMatch(/create table/);
    expect(sql).toContain("public.asset_meter_readings");
    expect(sql).toContain("insert into public.approvals");
    expect(sql).toContain("public.record_calculation_run(");
    expect(sql).not.toContain(
      "create or replace function public.record_component_removal",
    );
    expect(sql).not.toContain(
      "create or replace function public.record_repairable",
    );
  });
  it("requires exact independent human review with verified AAL2 and optimistic versions", () => {
    expect(sql).toContain("public.app_current_aal() is distinct from 'aal2'");
    expect(sql).toContain("public.app_actor_has_verified_mfa(auth.uid())");
    expect(sql).toContain("c.survival_recorded_by=auth.uid()");
    expect(sql).toContain("c.survival_version<>p_expected_version");
    expect(sql).toContain(
      "v_current is distinct from c.survival_evidence_snapshot",
    );
    expect(sql).toContain("'kind','survival_installed_overlay'");
    expect(sql).toContain("'operationalauthorization',false");
  });
  it("reuses claim/source standing and exact installation, meter and condition evidence", () => {
    expect(sql).toContain(
      "public.survival_evidence_snapshot_before_installed_internal(",
    );
    expect(sql).toContain("'installationevidenceitemid'");
    expect(sql).toContain("'meterevidenceitemid'");
    expect(sql).toContain("e.ts=c.installed_at");
    expect(sql).toContain("e.ts=m.recorded_at");
    expect(sql).toContain("m.value-c.installed_meter_hours");
    expect(sql).not.toMatch(/greatest\s*\(\s*0/);
  });
  it("retains the complete installed and removed census and refuses unlinked removals", () => {
    expect(sql).toContain("'activeinstances'");
    expect(sql).toContain("'removedinstances'");
    expect(sql).toContain("'populationgaps'");
    expect(sql).toContain("'componentinstanceid'");
    expect(sql).toContain("ci.state<>'removed'");
    expect(sql).toContain("ci.state='removed'");
    expect(sql).toContain("complete physical-life census");
  });
  it("serializes instance/meter changes and retains all canonical source references atomically", () => {
    expect(sql).toContain("on public.component_instances");
    expect(sql).toContain("on public.asset_meter_readings");
    expect(sql).toContain(":survival-life-population");
    expect(sql).toContain("p_source_snapshot is distinct from v_source");
    expect(sql).toContain("'table','component_instances'");
    expect(sql).toContain("'table','asset_meter_readings'");
    expect(sql).toContain("jsonb_array_elements(v_all)");
    expect(sql).toContain("'may_change_pm_interval',false");
  });
  it("requires pinned mixed-population execution during a rolling deployment", () => {
    expect(sql).toContain(
      "p_result->>'populationversion' is distinct from 'survival-census/2/draft'",
    );
    expect(sql).toContain(
      "p_result->>'subjects' is distinct from v_expected_subjects::text",
    );
    expect(sql).toContain("'code','incomplete_census'");
    expect(edge).toContain(
      "p_result: { ...result, populationVersion: SURVIVAL_CENSUS_VERSION }",
    );
    expect(edge).toContain("choose_one_explicit_survival_scenario");
  });
  it("keeps live canonical installation, review, lineage, removal and stale-meter assertions in the actual hosted smoke", () => {
    for (const assertion of [
      "record_component_installation",
      "record_asset_meter_reading",
      "record_survival_installed_overlay",
      "review_survival_installed_overlay",
      "r['subjects']==13 and r['failures']==8",
      "s['profile']['originHours']==8",
      "r.input_refs @>",
      "record_component_removal",
      'x["result"]["code"]=="incomplete_census"',
      'x["result"]["code"]=="source_changed"',
      'not x["activeInstances"][0]["sourceCurrent"]',
      'x["removedInstances"][0]["reconciled"]',
    ])
      expect(smoke).toContain(assertion);
  });
});
