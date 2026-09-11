import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261219134000_repeat_failure_metrics.sql",
  "utf8",
);
const panel = readFileSync("src/components/RepeatFailureMetrics.tsx", "utf8");
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");

describe("repeat-failure metric contract", () => {
  it("uses human-coded mechanisms and never raw source labels", () => {
    expect(migration).toContain("failure_mechanism_id");
    expect(migration).toContain("public.damage_mechanisms");
    expect(migration).not.toContain("w.actual_failure_mode");
    expect(migration).toContain("uncodedEventsExcluded");
    expect(migration).toContain("incompleteCodingProvenanceExcluded");
    expect(migration).toContain("w.mechanism_coded_by is not null");
    expect(migration).toContain("w.mechanism_coded_at is not null");
    expect(migration).toContain("length(btrim(w.mechanism_note))");
  });

  it("implements the adopted same-item, same-mode, defined-window rule", () => {
    expect(migration).toContain(
      "partition by w.asset_id, w.failure_mechanism_id",
    );
    expect(migration).toContain("lag(w.completed_at) over sequence");
    expect(migration).toContain("make_interval(days => v_recurrence_days)");
    expect(migration).toContain(
      "'eventsReturned', least(totals.repeat_events, 100)",
    );
    expect(migration).toContain("limit 100");
    expect(migration).toContain(
      "least(greatest(coalesce(p_recurrence_days, 90), 7), 730)",
    );
  });

  it("is tenant-bound and makes coding provenance unforgeable", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("'error', 'forbidden'");
    expect(migration).toContain(
      "revoke all on function public.get_repeat_failure_metrics(int, int) from public, anon",
    );
    expect(migration).toContain("trg_protect_failure_mechanism_provenance");
    expect(migration).toContain("before insert or update or delete");
    expect(migration).toContain(
      "governed coded failure history cannot be deleted directly",
    );
    expect(migration).toContain("new.asset_id,new.work_type,new.completed_at");
    expect(migration).toContain(
      "governed failure history changes require the approved closeout or coding function",
    );
    expect(migration).toContain("if v_role is null or v_role not in");
    expect(migration).toContain(
      "revoke all on function public.get_work_management_health_base3(int)",
    );
  });

  it("repairs work health and exposes evidence in Reliability", () => {
    expect(migration).toContain("get_work_management_health_base3");
    expect(migration).toContain("m->>'key' = 'rework_repeat'");
    expect(migration).toContain("from public.quality_defects q");
    expect(migration).toContain("'key', 'rework_rate'");
    expect(migration).toContain("'key', 'repeat_work'");
    expect(panel).toContain('supabase.rpc("get_repeat_failure_metrics"');
    expect(page).toContain("<RepeatFailureMetrics />");
  });
});
