import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const assetPage = readFileSync("src/pages/AssetDetailPage.tsx", "utf8");
const dashboard = readFileSync("src/services/dashboardServices.ts", "utf8");
const realtime = readFileSync("src/hooks/useRealtimeUpdates.ts", "utf8");
const materials = readFileSync("src/services/materialsCallers.ts", "utf8");
const runbook = readFileSync(
  "supabase/functions/runbook-executor/index.ts",
  "utf8",
);
const orchestrator = readFileSync(
  "supabase/functions/autonomous-orchestrator/index.ts",
  "utf8",
);

describe("materials and condition callers reach live stores", () => {
  it("asset history reads condition readings and does not invent a health score", () => {
    expect(assetPage).toContain("listAssetConditionReadings");
    expect(assetPage).not.toContain("asset_health_monitoring");
    expect(assetPage).not.toContain("health_score");
    expect(dashboard).toContain("listRecentConditionReadings");
    expect(dashboard).not.toContain('.from("asset_health_monitoring")');
    expect(realtime).toContain('table: "sensors"');
    expect(realtime).not.toContain('table: "asset_health_monitoring"');
  });

  it("lot condition and substitution call the existing recovery contracts", () => {
    expect(materials).toContain('"upsert_material_stock_lot"');
    expect(materials).toContain('"set_material_substitution"');
    expect(materials).toContain('"material_stock_lots"');
  });

  it("runbook sensor history and evidence use the canonical stores", () => {
    expect(runbook).toContain(".from('condition_readings')");
    expect(runbook).toContain(".gte('taken_at', startTime)");
    expect(runbook).toContain(".from('condition_alerts')");
    expect(runbook).toContain(".from('evidence_items')");
    expect(runbook).toContain("data_quality: 'unknown'");
    expect(runbook).toContain(".from('work_order_materials')");
    expect(runbook).toContain(".from('material_stock_lots')");
    expect(runbook).not.toContain(".from('asset_health_monitoring')");
    expect(runbook).not.toContain(".gte('recorded_at'");
    expect(runbook).toContain("reason: 'not_implemented'");
    expect(runbook).toContain("verification_status: 'unverified'");
    expect(runbook).not.toMatch(/return \{ action: actionType, executed: true \}/);
    expect(runbook).toContain("from('user_profiles')");
    expect(runbook).toContain("data.organization_id !== callerOrg");
    expect(runbook).toContain("order.organization_id !== callerOrg");
    expect(runbook).not.toContain("triggerData.organization_id");
  });

  it("asset monitoring cites open condition alerts and does not invent limits", () => {
    const monitor = orchestrator.slice(
      orchestrator.indexOf("async function monitorAssets"),
      orchestrator.indexOf("async function processDecision"),
    );
    expect(monitor).toContain('from("condition_alerts")');
    expect(monitor).toContain("condition_alert_review");
    expect(monitor).toContain("confidence_score: null");
    expect(monitor).not.toContain('.from("normalized_signals")');
    expect(monitor).not.toContain('.from("asset_health_monitoring")');
    expect(monitor).not.toContain("health_score:");
    expect(monitor).not.toMatch(/temp - 90|vibration - 5|pressure > 150/);
  });
});
