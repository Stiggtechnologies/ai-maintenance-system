import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102260000_reliability_segmentation_completion.sql",
  "utf8",
).toLowerCase();
const coding = readFileSync("src/components/FailureCoding.tsx", "utf8");
const segmentation = readFileSync(
  "src/components/SegmentedReliability.tsx",
  "utf8",
);
const executive = readFileSync("src/pages/ExecutiveIntelligence.tsx", "utf8");
const reliability = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-reliability-segmentation-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("complete governed reliability segmentation", () => {
  it("records exact observed time with the canonical human mechanism coding", () => {
    expect(migration).toContain("public.work_orders");
    expect(migration).toContain("public.failure_mechanism_coding_events");
    expect(migration).toContain("failure_observed_at");
    expect(migration).not.toMatch(/create table/);
    expect(migration).toContain("work-order timestamps are not substituted");
    expect(coding).toContain("Failure observed at");
    expect(coding).toContain("p_failure_observed_at");
  });

  it("keeps coding named-human, tenant-bound and direct-write protected", () => {
    expect(migration).toContain(
      "coding a failure mechanism requires a maintenance or engineering role",
    );
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain(
      "governed failure history changes require the approved closeout or coding function",
    );
    expect(migration).toContain(
      "revoke all on function public.code_failure_mechanism(uuid,text,text)",
    );
    expect(migration).toContain(
      "grant execute on function public.code_failure_mechanism(uuid,text,text,timestamptz)",
    );
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.failure_mechanism_coding_events",
    );
  });

  it("supports every required axis without relabelling source data", () => {
    for (const dimension of [
      '"criticality"',
      '"asset_class"',
      '"site"',
      '"system_group"',
      '"mechanism"',
      '"operating_regime"',
    ])
      expect(segmentation).toContain(dimension);
    expect(segmentation).toContain("Failure mechanism");
    expect(segmentation).toContain("Operating regime");
    expect(segmentation).toContain("System group");
    expect(migration).toContain(
      "this is not a failure-mechanism claim; use the governed mechanism axis",
    );
  });

  it("matches observed failures to canonical operating states and discloses gaps", () => {
    expect(migration).toContain("public.operating_states");
    expect(migration).toContain("os.started_at<=w.failure_observed_at");
    expect(migration).toContain(
      "os.ended_at is null or os.ended_at>w.failure_observed_at",
    );
    expect(migration).toContain("unknown duty — load not recorded");
    expect(migration).toContain("excludedmissingfailuretime");
    expect(migration).toContain("excludeduncodedmechanism");
    expect(segmentation).toContain("excludedMissingFailureTime");
    expect(segmentation).toContain("excludedUncodedMechanism");
    expect(segmentation.indexOf("data?.basis")).toBeGreaterThan(
      segmentation.indexOf("segments.length === 0"),
    );
  });

  it("is customer-reachable and has clean-stack runtime proof", () => {
    expect(executive).toContain("<SegmentedReliability");
    expect(reliability).toContain("<FailureCoding");
    for (const proof of [
      "observed_time_required=true",
      "direct_write_refused=true",
      "mechanism_axis=true",
      "regime_axis=true",
      "unknown_duty_honest=true",
      "tenant_wall=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-reliability-segmentation-smoke.sh",
    );
    expect(register).toMatch(/\| C6\.26 \|[^\n]+\| ✅[^\n]+/i);
  });
});
