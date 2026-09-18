import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261219154000_develop_operational_readiness_index.sql", "utf8").toLowerCase();
const service = readFileSync("src/services/developService.ts", "utf8");
const panel = readFileSync("src/components/develop/ReadinessPanels.tsx", "utf8");
const smoke = readFileSync("scripts/ci-develop-operational-readiness-index-smoke.sh", "utf8");

describe("D8.11 governed Operational Readiness Index", () => {
  it("uses canonical system readiness and all nine named factors", () => {
    expect(migration).toContain("join public.commissioning_system_readiness_scope");
    expect(migration).toContain("join public.asset_onboarding_items");
    for (const factor of ["people","procedures","asset_data","maintenance","spares","training","operations","safety","cyber"]) expect(migration).toContain(`'${factor}'`);
    expect(migration).not.toContain("readiness_status");
  });
  it("requires an adopted, evidenced human policy and never invents defaults", () => {
    expect(migration).toContain("no case-specific operational readiness index policy is adopted");
    expect(migration).toContain("same-tenant evidence applicable to this case is required");
    expect(migration).toContain("named human admin or executive");
    expect(migration).toContain("exactly nine factors");
    expect(migration).toContain("unassigned category");
    expect(smoke).toContain('"refusal"]=="no_adopted_profile"');
  });
  it("applies hard-condition override and preserves human authority", () => {
    expect(migration).toContain("r.safety_mission_critical or i.requirement_key=any(p.hard_requirement_keys)");
    expect(migration).toContain("when v_hard_count>0 then 'blocked'");
    expect(migration).toContain("cannot accept handover");
    expect(smoke).toContain('c["status"]=="BLOCKED"');
  });
  it("is tenant isolated, immutable, audited and customer reachable", () => {
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("adopted or superseded index policy content is immutable");
    expect(migration).toContain("operational_readiness_index_profile");
    expect(service).toContain('"get_case_operational_readiness_index"');
    expect(service).toContain('"save_case_operational_readiness_index_profile"');
    expect(panel).toContain("Operational Readiness Index");
    expect(panel).toContain("Adopt this policy");
  });
});
