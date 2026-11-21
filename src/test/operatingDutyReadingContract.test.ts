import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271114120000_operating_duty_readings.sql",
  "utf8",
);
const service = readFileSync("src/services/operatingDutyService.ts", "utf8");
const panel = readFileSync("src/components/OperatingDutyPanel.tsx", "utf8");
const host = readFileSync("src/components/AssetOperatingDuty.tsx", "utf8");
const assetPage = readFileSync("src/pages/AssetDetailPage.tsx", "utf8");
const executive = readFileSync("src/components/OperatingContext.tsx", "utf8");

describe("E3.03 operating duty reading", () => {
  it("reuses operating states, process events and the one audit ledger", () => {
    expect(migration).toContain("from public.operating_states");
    expect(migration).toContain("from public.process_events");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/insert\s+into\s+(public\.)?condition_alerts/i);
    expect(migration).not.toMatch(/insert\s+into\s+(public\.)?work_orders/i);
    expect(migration).not.toMatch(/from\s+(public\.)?condition_alerts/i);
    expect(migration).toContain("condition_alerts_consulted', false");
  });

  it("counts starts, stops, cycles and excursions without inventing load", () => {
    expect(migration).toContain("and state = 'running'");
    expect(migration).toContain("and started_at >= v_from and started_at <= v_to");
    expect(migration).toContain("and ended_at is not null");
    expect(migration).toContain("cycles_completed <= starts");
    expect(migration).toContain("cycles_completed <= stops");
    expect(migration).toContain("event_type = 'excursion'");
    expect(migration).toContain("event_type = 'trip'");
    expect(migration).toContain("where load_pct is not null");
    expect(migration).toContain("No load is inferred.");
    expect(migration).toContain("Silence is not uptime.");
    expect(migration).toContain("That figure is not utilisation.");
  });

  it("is tenant scoped, human retained, audited and append-only", () => {
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("id = p_asset_id and organization_id = v_org");
    expect(migration).toContain(
      "AI cannot record an operating-duty reading; a named human must retain it",
    );
    expect(migration).toContain("coalesce(v_role, '') = 'ai_admin'");
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("source_digest = v_digest");
    expect(migration).toContain("interval '2 minutes'");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("previous_state");
    expect(migration).toContain("new_state");
    expect(migration).toContain("operating_duty_readings is append-only");
    expect(migration).toContain(
      "before truncate on public.operating_duty_readings",
    );
    expect(migration).toContain(
      "using (organization_id = public.app_current_org())",
    );
  });

  it("keeps direct writes closed and does not grant the act to anonymous or service callers", () => {
    for (const fn of [
      "compute_operating_duty(uuid, integer)",
      "preview_operating_duty(uuid, integer)",
      "record_operating_duty_reading(uuid, integer, text)",
      "get_operating_duty_readings(uuid, integer)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}`);
    }
    expect(migration).toContain(
      "grant execute on function public.preview_operating_duty(uuid, integer) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.record_operating_duty_reading(uuid, integer, text) to authenticated",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.record_operating_duty_reading[\s\S]*to anon/,
    );
    expect(migration).toContain(
      "revoke all on table public.operating_duty_readings from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "does not acknowledge an alarm, create work, change a limit, or release equipment",
    );
  });

  it("is reachable from the asset and executive duty surfaces", () => {
    expect(service).toContain('"preview_operating_duty"');
    expect(service).toContain('"record_operating_duty_reading"');
    expect(service).toContain('"get_operating_duty_readings"');
    expect(panel).toContain("previewOperatingDuty(assetId, windowDays)");
    expect(panel).toContain("recordOperatingDutyReading(assetId, windowDays, note)");
    expect(panel).toContain("getOperatingDutyReadings(assetId)");
    expect(host).toContain("<OperatingDutyPanel assetId={assetId} windowDays={windowDays} />");
    expect(assetPage).toContain("<AssetOperatingDuty assetId={asset.id} />");
    expect(executive).toContain("<AssetOperatingDuty assetId={assetId} />");
  });
});
