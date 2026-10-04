import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102250000_ca_strategy_update_linkage.sql",
  "utf8",
).toLowerCase();
const panel = readFileSync("src/components/CaEffectivenessPanel.tsx", "utf8");
const smoke = readFileSync("scripts/ci-ca-strategy-update-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed corrective-action strategy update", () => {
  it("links closure to the canonical immutable lifecycle-plan version", () => {
    expect(migration).toContain("public.ca_verifications");
    expect(migration).toContain("public.asset_lifecycle_plans");
    expect(migration).toContain("strategy_lifecycle_plan_id");
    expect(migration).not.toMatch(/create table/);
    expect(migration).toContain(
      "foreign key (organization_id, asset_id, strategy_lifecycle_plan_id)",
    );
    expect(migration).toContain(
      "references public.asset_lifecycle_plans(organization_id, asset_id, id)",
    );
  });

  it("retires the blind strategy attestation and requires an actual programme change", () => {
    expect(migration).toContain(
      "strategy completion requires a same-asset adopted lifecycle-plan version",
    );
    expect(migration).toContain("p_stage not in ('physical', 'causal')");
    expect(migration).toContain("l.adopted_action <> 'apply_recommended'");
    expect(migration).toContain("l.adopted_strategy ->> 'programmechanged'");
    expect(panel).not.toContain('p_stage: "strategy"');
  });

  it("preserves named-human authority, tenant scope and immutable evidence", () => {
    expect(migration).toContain("not in ('reliability_engineer', 'admin')");
    expect(migration).toContain("and organization_id = v_org");
    expect(migration).toContain("and asset_id = v.asset_id");
    expect(migration).toContain(
      "corrective-action strategy evidence is already linked and immutable",
    );
    expect(migration).toContain("public.audit_events");
    expect(migration).toContain("'ca_strategy_update'");
    expect(migration).toContain("risk acceptance, work release, expenditure");
  });

  it("is reachable from the corrective-action effectiveness workspace", () => {
    expect(panel).toContain('supabase.rpc("link_ca_strategy_update"');
    expect(panel).toContain("Open Asset Strategy Specialist");
    expect(panel).toContain("Link adopted strategy");
    expect(panel).toContain("strategy_lifecycle_plan_id");
  });

  it("has clean-stack runtime proof and an honest green register claim", () => {
    for (const proof of [
      "blind_attestation_refused=true",
      "stage_order=true",
      "same_asset_plan=true",
      "programme_changed=true",
      "immutable_link=true",
      "tenant_wall=true",
      "audit_lineage=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-ca-strategy-update-smoke.sh");
    expect(register).toMatch(/\| C4\.12 \|[^\n]+\| ✅[^\n]+/i);
  });
});
