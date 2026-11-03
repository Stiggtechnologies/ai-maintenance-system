import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_ADMIN_REFUSAL,
  FORECAST_AUTHORITY,
  PLAN_ROLLUP_BASIS,
  POINT_BASIS,
  REFUSAL,
  ROLE_REFUSAL,
  VERIFICATION_REFUSAL,
} from "../lib/production-plan/forecast";

const migration = readFileSync(
  "supabase/migrations/20271105130000_production_plan_loss_forecast.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/productionPlanForecastService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ProductionPlanLossForecast.tsx",
  "utf8",
);
const parent = readFileSync("src/pages/HandoverPage.tsx", "utf8");
const parser = readFileSync(
  "src/lib/production-plan/sapPlannedOrder.ts",
  "utf8",
);

describe("E3.07 production-plan loss forecast", () => {
  it("reuses operating state, production records and the existing human-role gate", () => {
    expect(migration).toContain("from public.operating_states s");
    expect(migration).toContain("from public.production_records p");
    expect(migration).toContain("public.production_loss_human_role_allowed()");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table if not exists public\.(production_losses|downtime_events)\b/,
    );
    expect(migration).not.toMatch(
      /nameplate|design_capacity|rated_capacity|https?:\/\//i,
    );
    expect(migration).not.toMatch(/\b_usd\b|dollar/i);
  });

  it("locks the tested refusal sentences and the plan-level formula", () => {
    for (const sentence of [
      ...Object.values(REFUSAL),
      ...Object.values(VERIFICATION_REFUSAL),
      POINT_BASIS,
      PLAN_ROLLUP_BASIS,
      FORECAST_AUTHORITY,
      AI_ADMIN_REFUSAL,
      ROLE_REFUSAL,
    ]) {
      expect(migration).toContain(sentence);
    }
    expect(migration).toContain(
      "v_planned * v_unplanned_hours / v_covered_hours",
    );
    expect(migration).toContain("v_covered_hours / v_history_hours < 0.25");
    expect(migration).toContain("v_records < 2");
    expect(migration).toContain("v_event_count < 2");
    expect(migration).toContain("v_event_count >= 5");
    expect(migration).toContain("percentile_disc(0.5)");
    expect(migration).toContain("percentile_disc(0.8)");
    expect(migration).toContain("'counterfactual'");
    expect(migration).toContain(
      "least(greatest(coalesce(p_history_days, 180), 30), 730)",
    );
    expect(
      migration.match(
        /ai_admin cannot record, forecast, review or verify a production plan/g,
      ),
    ).toHaveLength(4);
  });

  it("is append-only, tenant scoped, and written only through the human doors", () => {
    for (const table of [
      "production_plans",
      "production_plan_lines",
      "production_plan_forecasts",
      "production_plan_forecast_reviews",
      "production_plan_forecast_verifications",
    ]) {
      expect(migration).toContain(`organization_id = public.app_current_org()`);
      expect(migration).toContain(`on public.${table}`);
      expect(migration).toContain(
        `revoke insert, update, delete, truncate on public.${table}`,
      );
    }
    expect(migration).toContain(
      "production-plan forecast records are append-only",
    );
    expect(migration).toContain(
      "check (verification_state = 'counterfactual')",
    );
    expect(migration).toContain(
      "The person who generated the forecast cannot verify it.",
    );
    expect(migration).toContain(
      "The person who generated the forecast cannot review it.",
    );
    expect(migration).toContain("'sapContacted',false");
    expect(migration).toContain("where organization_id = v_org");
  });

  it("is reachable from handover and the SAP path is a local mock", () => {
    for (const rpc of [
      "get_production_plan_loss_forecast",
      "record_production_plan",
      "forecast_production_plan_loss",
      "review_production_plan_forecast",
      "verify_production_plan_forecast",
    ]) {
      expect(service).toContain(`"${rpc}"`);
      expect(migration).toContain(`function public.${rpc}`);
    }
    expect(panel).toContain("Production-plan loss forecast");
    expect(panel).toContain("parseSapPlannedOrderPayload");
    expect(panel).toContain("Load mocked SAP planned-order sample");
    expect(panel).toContain("Nothing is sent to SAP");
    expect(parent).toContain("<ProductionPlanLossForecast />");
    expect(parser).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
    expect(parser).toContain("A_PlannedOrder");
    expect(parser).not.toContain("assetId");
  });
});
