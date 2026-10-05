import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20270102350000_asset_operational_monitor.sql",
  ),
  "utf8",
);
const service = fs.readFileSync(
  path.join(root, "src/services/assetOperationalMonitorService.ts"),
  "utf8",
);
const page = fs.readFileSync(
  path.join(root, "src/pages/AssetDetailPage.tsx"),
  "utf8",
);

describe("C8.03 exact-asset operational monitor contract", () => {
  it("reconciles the four canonical evidence streams without a parallel store", () => {
    expect(migration).toContain(
      "create or replace function public.get_asset_operational_monitor",
    );
    for (const source of [
      "public.condition_readings",
      "public.condition_alerts",
      "public.work_orders",
      "public.operating_states",
      "public.production_records",
      "public.risks",
      "public.risk_indicators",
      "public.learning_events",
    ]) {
      expect(migration).toContain(source);
    }
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.asset_operational_monitor/i,
    );
  });

  it("preserves exact tenant, asset and sensitivity boundaries", () => {
    expect(migration).toContain("a.id=p_asset_id and a.organization_id=v_org");
    expect(migration).toContain("r.asset_id=p_asset_id");
    expect(migration).toContain("public.can_read_risk(r.id)");
    expect(migration).toContain(
      "return jsonb_build_object('error','asset not found')",
    );
    expect(migration).toContain("to authenticated");
    expect(migration).not.toContain("to anon");
  });

  it("uses demonstrated production and refuses missing evidence", () => {
    expect(migration).toContain("pt.units/st.running_hours");
    expect(migration).toContain("'demonstrated_rate'");
    expect(migration).toContain("'not_measurable'");
    expect(migration).toContain("Nameplate capacity is never substituted");
    expect(migration).not.toMatch(/nameplate(_capacity)?\s*\*/i);
  });

  it("is explicitly read-only and grants no consequential authority", () => {
    for (const gate of [
      "'mayCreateWork',false",
      "'mayChangeWork',false",
      "'mayApprove',false",
      "'mayAcceptRisk',false",
      "'mayCommitSpend',false",
      "'mayChangeOperatingLimits',false",
      "'mayReturnToService',false",
    ]) {
      expect(migration).toContain(gate);
    }
    expect(migration).not.toMatch(
      /insert into public\.(work_orders|approvals|decisions|recommendations)/i,
    );
    expect(migration).not.toMatch(
      /update public\.(work_orders|risks|operating_states)/i,
    );
  });

  it("is reachable from the exact asset customer surface", () => {
    expect(service).toContain('"get_asset_operational_monitor"');
    expect(page).toContain('label: "Operational Monitor"');
    expect(page).toContain("<AssetOperationalMonitor assetId={asset.id} />");
  });
});
