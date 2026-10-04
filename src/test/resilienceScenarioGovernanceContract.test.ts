import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THREAT_KINDS } from "../services/resilienceConfigurationService";

const migration = readFileSync(
  "supabase/migrations/20270102240000_resilience_scenario_governance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/resilienceConfigurationService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ResilienceConfigurationPanel.tsx",
  "utf8",
);
const resiliencePanel = readFileSync(
  "src/components/ResiliencePanel.tsx",
  "utf8",
);
const emergencyPage = readFileSync("src/pages/EmergencyMode.tsx", "utf8");

describe("E11 governed resilience configuration", () => {
  it("extends the canonical scenario and mode records without another engine", () => {
    expect(migration).toContain("alter table public.threat_scenarios");
    expect(migration).toContain("alter table public.scenario_exposure");
    expect(migration).toContain(
      "alter table public.operating_mode_definitions",
    );
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(?:resilience_scenarios|resilience_operating_modes|scenario_cascades)/,
    );
    expect(migration).not.toContain("insert into public.operating_mode_events");
  });

  it("models all thirteen threat kinds, including smoke as a distinct exposure", () => {
    expect(THREAT_KINDS).toHaveLength(13);
    for (const kind of [
      "wildfire",
      "smoke",
      "flood",
      "extreme_cold",
      "cyber_incident",
    ]) {
      expect(THREAT_KINDS).toContain(kind);
      expect(migration).toContain(`'${kind}'`);
    }
  });

  it("fails closed on identity, tenancy, evidence shape and provenance gaps", () => {
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain(
      "scenario evidence and missing-evidence values must be arrays",
    );
    expect(migration).toContain(
      "cite canonical evidence or explicitly name missing evidence",
    );
    expect(migration).toContain(
      "every exposed asset must belong to this organization",
    );
    expect(migration).toContain("scenario_exposure_scenario_tenant_fk");
    expect(migration).toContain("scenario_exposure_asset_tenant_fk");
    expect(migration).toContain("e.organization_id=t.organization_id");
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain(
      "quantitative annual likelihood requires at least one verified canonical evidence item",
    );
    expect(migration).toContain(
      "exposure mapping requires verified evidence or an explicit scenario evidence gap",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("previous_state,new_state");
    expect(migration).toContain("guard_resilience_configuration_write");
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain(
      "revoke all on function public.save_threat_scenario(jsonb) from public,anon",
    );
  });

  it("reads execution state only from the independently authorized Recovery workflow", () => {
    expect(migration).toContain("from public.recovery_operating_commands");
    expect(migration).toContain("then 'unrecorded'");
    expect(migration).toContain("else 'mixed'");
    expect(migration).toContain("policy definition only");
    expect(migration).not.toMatch(
      /update\s+public\.recovery_operating_commands\s+set/,
    );
    expect(migration).not.toMatch(
      /create or replace function public\.review_recovery_operating_mode\(/,
    );
  });

  it("is customer reachable before or during a critical incident", () => {
    for (const rpc of [
      "get_resilience_configuration_workspace",
      "save_threat_scenario_with_exposure",
      "save_operating_mode_definition",
    ]) {
      expect(service).toContain(`"${rpc}"`);
    }
    expect(panel).not.toContain("replaceScenarioExposure");
    expect(panel).toContain("Configure scenarios and operating-mode policy");
    expect(panel).toContain("This does not change operating state");
    expect(panel).toContain("exposure remains explicitly provisional");
    expect(resiliencePanel).toContain("<ResilienceConfigurationPanel");
    expect(emergencyPage.match(/<ResiliencePanel \/>/g)).toHaveLength(2);
    expect(emergencyPage).not.toContain("activates automatically");
    expect(emergencyPage).not.toContain("becomes the incident command center");
  });
});
