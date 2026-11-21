import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271115120000_production_constraint_bottlenecks.sql",
  "utf8",
);
const lower = migration.toLowerCase();
const service = readFileSync(
  "src/services/productionConstraintService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ProductionConstraintBottlenecks.tsx",
  "utf8",
);
const parent = readFileSync(
  "src/components/ProductionLossReconciliation.tsx",
  "utf8",
);
const handover = readFileSync("src/pages/HandoverPage.tsx", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);
const rules = readFileSync(
  "src/lib/production-constraints/bottleneck.ts",
  "utf8",
);

describe("E3.04 production constraint bottleneck contract", () => {
  it("ranks declared limits without a second production plan or loss ledger", () => {
    expect(lower).toContain(
      "create table if not exists public.production_constraint_studies",
    );
    expect(lower).toContain(
      "create table if not exists public.production_constraint_limits",
    );
    expect(lower).not.toMatch(
      /create table if not exists public\.(production_plans|production_losses|downtime_events)\b/,
    );
    expect(lower).toContain("from public.production_records p");
    expect(lower).toContain("from public.operational_constraint_signals s");
    expect(lower).toContain("demonstratedoutputusedascapacity");
    expect(lower).toContain("limitsareadditive', false");
    expect(lower).toContain("v_min < v_required");
    expect(lower).not.toMatch(/update\s+public\.work_orders\b/);
    expect(lower).not.toMatch(/update\s+public\.production_records\b/);
  });

  it("uses the same refusal reasons as the ranked rule", () => {
    for (const reason of [
      "no_limits_declared",
      "mixed_units",
      "unquantified_limit",
    ]) {
      expect(lower).toContain(reason);
      expect(rules).toContain(`"${reason}"`);
    }
    expect(rules).toContain("They are never added together");
    expect(lower).toContain("are not added together");
  });

  it("is a named-human tenant act with an append-only audit", () => {
    expect(lower).toContain("v_org uuid := public.app_current_org()");
    expect(lower).toContain("v_role = 'ai_admin'");
    expect(lower).toContain(
      "ai_admin cannot record a production constraint study",
    );
    expect(lower).toContain(
      "a named operations or maintenance role is required",
    );
    expect(lower).toContain(
      "site is outside the active tenant or does not exist",
    );
    expect(lower).toContain(
      "asset is outside the active tenant or does not belong to this site",
    );
    expect(lower).toContain(
      "constraint signal is outside the active tenant or does not apply to this site",
    );
    expect(lower).toContain("stateconvertedtoquantity', false");
    expect(lower).toContain("insert into public.audit_events");
    expect(lower).toContain("production constraint studies are append-only");
    expect(lower).toContain("production_constraint_studies_content_unique");
    expect(lower).toContain(
      "revoke all on table public.production_constraint_studies",
    );
    expect(lower).toContain("service_role");
    expect(lower).toContain("organization_id = public.app_current_org()");
  });

  it("is reachable from the handover surface through the governed RPCs", () => {
    expect(service).toContain('"get_production_constraint_studies"');
    expect(service).toContain('"record_production_constraint_study"');
    expect(service).toContain('from("assets")');
    expect(service).toContain("listSites");
    expect(panel).toContain("Production constraints and bottlenecks");
    expect(panel).toContain("Record constraint study");
    expect(parent).toContain("<ProductionConstraintBottlenecks />");
    expect(handover).toContain("<ProductionLossReconciliation />");
    expect(register).toMatch(
      /\| E3\.04 \|[^\n]+\| ✅[^\n]+record_production_constraint_study/,
    );
  });
});
