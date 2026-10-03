import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101770000_data_residency_sovereignty.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/dataResidencyService.ts", "utf8");
const surface = readFileSync(
  "src/components/DataResidencyGovernance.tsx",
  "utf8",
);
const host = readFileSync("src/components/DataGovernance.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-data-residency-sovereignty-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E12.14 data residency and sovereignty", () => {
  it("extends the canonical deployment and audit records without shadowing retention", () => {
    expect(migration).toContain("alter table public.deployment_instances");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain(
      "create table if not exists public.deployment_data_locations",
    );
    expect(migration).not.toMatch(
      /create table if not exists public\.(retention|audit_events|deployment_instances)/,
    );
    expect(migration).toContain(
      "retention remains governed by the canonical retention and archive controls",
    );
  });

  it("keeps policy and evidence tenant-bound, immutable and human-governed", () => {
    expect(migration).toContain("organization_id = public.app_current_org()");
    expect(migration).toContain("deployment location evidence is append-only");
    expect(migration).toContain("a named human administrator is required");
    expect(migration).toContain(
      "independent review requires a verifier other than the declarer",
    );
    expect(migration).toContain(
      "independent review requires a verifier other than the policy author",
    );
    expect(migration).toContain(
      "residency policy fields require governed named-human controls",
    );
  });

  it("requires the complete six-plane topology before pilot or production", () => {
    for (const plane of [
      "application",
      "database",
      "object_storage",
      "backup",
      "logging",
      "ai_inference",
    ])
      expect(migration).toContain(`'${plane}'`);
    expect(migration).toContain("required verified data planes are incomplete");
    expect(migration).toContain(
      "verified residency posture is required before pilot or production",
    );
    expect(migration).toContain(
      "country is not permitted by the current policy",
    );
    expect(migration).toContain(
      "provider region is not permitted by the current policy",
    );
    expect(migration).toContain(
      "a substantive cross-border transfer basis is required when more than one country is permitted",
    );
    expect(migration).toContain("residency_status='blocked'");
  });

  it("is honest about the assurance boundary", () => {
    expect(migration).toContain("does not relocate data");
    expect(migration).toContain(
      "does not move data or configure provider resources",
    );
    expect(surface).toContain("not move data or configure a cloud provider");
  });

  it("is customer-operable through Data Governance", () => {
    for (const rpc of [
      "get_data_residency_workspace",
      "configure_deployment_residency",
      "record_deployment_data_location",
      "verify_deployment_data_location",
      "verify_deployment_residency",
      "set_deployment_environment",
    ])
      expect(service).toContain(`"${rpc}"`);
    expect(surface).toContain("Record policy revision");
    expect(surface).toContain("Declare location");
    expect(surface).toContain("Verify complete posture");
    expect(host).toContain("<DataResidencyGovernance />");
  });

  it("has runtime proof in the required migration gate and closes the register", () => {
    for (const proof of [
      "tenant_wall=true",
      "named_human=true",
      "direct_write_closed=true",
      "country_gate=true",
      "six_planes=true",
      "independent_review=true",
      "supersession=true",
      "revision_invalidation=true",
      "production_gate=true",
      "honest_boundary=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-data-residency-sovereignty-smoke.sh",
    );
    expect(register).toMatch(/\| E12\.14 \|[^\n]+\| ✅[^\n]+/i);
  });
});
