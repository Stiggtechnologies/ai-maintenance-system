import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261219135000_failure_mode_reliability.sql", "utf8");
const panel = readFileSync("src/components/FailureModeReliability.tsx", "utf8");
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");

describe("failure-mode reliability contract", () => {
  it("uses human-coded mechanisms and canonical operating exposure", () => {
    expect(migration).toContain("w.failure_mechanism_id");
    expect(migration).toContain("public.damage_mechanisms");
    expect(migration).toContain("public.operating_states");
    expect(migration).toContain("os.state = 'running'");
    expect(migration).not.toContain("actual_failure_mode");
  });
  it("unions overlaps and never substitutes calendar exposure", () => {
    expect(migration).toContain("range_agg(tstzrange(");
    expect(migration).toContain("unnest(rr.covered) as ranges(piece)");
    expect(migration).toContain("calendar time is not substituted");
  });
  it("reports both metrics with evidence controls", () => {
    expect(migration).toContain("'mtbfHours'");
    expect(migration).toContain("'eventRatePer1000RunningHours'");
    expect(migration).toContain("event_rate_available");
    expect(migration).toContain("mtbf_available");
    expect(migration).toContain("'failuresWithRunningExposure'");
    expect(migration).toContain("uncodedCorrectiveEventsExcluded");
    expect(migration).toContain("incompleteCodingProvenanceExcluded");
    expect(migration).toContain("codedEventsOutsideApprovedScopeExcluded");
  });
  it("uses a governed full cohort, including scoped assets with zero failures", () => {
    expect(migration).toContain("public.asset_failure_mechanism_scopes");
    expect(migration).toContain("left join public.work_orders w");
    expect(migration).toContain("count(w.id)::int as failures");
    expect(migration).toContain("x.assets_with_exposure = c.scoped_assets");
    expect(migration).toContain("evidence_item_id uuid not null references public.evidence_items");
  });
  it("protects tenant scope and human approval", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("'error', 'forbidden'");
    expect(migration).toContain("v_role is null or v_role not in");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("revoke insert,update,delete,truncate on public.asset_failure_mechanism_scopes");
    expect(migration).toContain("limit 100");
    expect(migration).toContain("revoke all on function public.get_failure_mode_reliability(int, int) from public, anon");
    expect(panel).toContain('supabase.rpc("get_failure_mode_reliability"');
    expect(panel).toContain('supabase.rpc("record_asset_failure_mechanism_scope"');
    expect(panel).toContain("Select supporting evidence");
    expect(page).toContain("<FailureModeReliability />");
  });
});
