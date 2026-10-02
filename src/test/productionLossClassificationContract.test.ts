import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101510000_production_loss_classification.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/productionLossService.ts", "utf8");
const panel = readFileSync(
  "src/components/ProductionLossReconciliation.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/HandoverPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-production-loss-classification-smoke.sh",
  "utf8",
);
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("C2.06 governed production-loss reconciliation", () => {
  it("classifies canonical operating-state downtime without creating another event or loss ledger", () => {
    expect(migration).toContain("references public.operating_states(id)");
    expect(migration).toContain("from public.production_records p");
    expect(migration).toContain("from public.operational_constraint_signals s");
    expect(migration).not.toMatch(
      /create table if not exists public\.(production_losses|downtime_events|constraint_data)/,
    );
  });

  it("makes classification a named-human tenant act and retains every superseded interpretation", () => {
    expect(migration).toContain("production_loss_human_role_allowed");
    expect(migration).toContain("coalesce(up.role,'')<>'ai_admin'");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain(
      "v_previous is distinct from p_expected_review_id",
    );
    expect(migration).toContain("for update");
    expect(migration).toContain("downtime classifications are append-only");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("requires evidence basis and a canonical constraint for constrained-loss claims", () => {
    expect(migration).toContain("coalesce(length(btrim(p_basis)),0)<20");
    expect(migration).toContain("a constraint signal is required");
    expect(migration).toContain(
      "constraint signal is outside the active tenant",
    );
    expect(migration).toContain("work order is outside the active tenant");
    expect(migration).toContain("s.valid_until>=v_state.started_at");
    expect(migration).toContain("s.site_id=v_asset_site");
  });

  it("derives units at risk only from demonstrated rate and reports missing coverage", () => {
    expect(migration).toContain("p.units/nullif(r.running_hours,0)");
    expect(migration).toContain("never nameplate");
    expect(migration).toContain("not_measurable");
    expect(migration).toContain("unclassifieddownhours");
    expect(migration).toContain("e.event_rank<=200");
    expect(migration).toContain("lossbyunit");
    expect(migration).not.toContain("'estimatedunitslost',round(v_units");
    expect(panel).toContain("No nameplate assumptions");
  });

  it("is reachable in the operations handover surface through governed RPCs", () => {
    expect(service).toContain('"get_production_loss_reconciliation"');
    expect(service).toContain('"classify_downtime_event"');
    expect(panel).toContain("Production loss reconciliation");
    expect(parent).toContain("<ProductionLossReconciliation />");
    expect(panel).toContain('to="/recovery"');
    expect(panel).toContain('to="/integrations"');
  });

  it("has runtime tenant, human, provenance and calculation proof before claiming green", () => {
    for (const proof of [
      "named_human_only=true",
      "tenant_wall=true",
      "append_only=true",
      "constraint_required=true",
      "demonstrated_rate=true",
      "unit_separation=true",
      "unknown_visible=true",
      "direct_write_locked=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-production-loss-classification-smoke.sh",
    );
    expect(register).toMatch(/\| C2\.06 \|[^\n]+\| ✅[^\n]+/i);
  });
});
