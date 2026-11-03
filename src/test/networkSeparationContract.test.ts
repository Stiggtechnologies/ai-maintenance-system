import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271106150000_ot_it_network_separation.sql",
  "utf8",
);
const panel = readFileSync("src/components/NetworkSeparationPanel.tsx", "utf8");
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");
const service = readFileSync(
  "src/services/networkSeparationService.ts",
  "utf8",
);
const sapCore = readFileSync("src/test/sapS4WriteCore.test.ts", "utf8");

describe("E5.03 OT/IT network separation", () => {
  it("extends the canonical zone tables and does not open a second store", () => {
    expect(migration).toContain("alter table public.network_zones");
    expect(migration).toContain(
      "alter table public.connector_zone_assignments",
    );
    expect(migration).not.toMatch(/create table[^;]*network_zones/i);
    expect(migration).not.toMatch(
      /create table[^;]*connector_zone_assignments/i,
    );
    expect(migration).not.toMatch(/create table[^;]*audit/i);
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("insert into public.security_events");
    expect(migration).toContain("insert into public.network_zones");
    expect(migration).toContain("update public.network_zones");
    expect(migration).toContain(
      "insert into public.connector_zone_assignments",
    );
    expect(migration).toContain("update public.connector_zone_assignments");
  });

  it("keeps writes on governed definers and refuses direct mutation", () => {
    for (const name of [
      "propose_network_zone",
      "decide_network_zone",
      "propose_connector_zone_assignment",
      "decide_connector_zone_assignment",
      "get_network_separation",
      "connector_zone_crossing",
    ]) {
      expect(migration).toContain(`function public.${name}(`);
      expect(migration).toContain(`revoke all on function public.${name}`);
    }
    expect(migration).toContain("security definer");
    expect(migration).toContain("app.network_zone_writer");
    expect(migration).toContain(
      "revoke insert, update, delete on public.network_zones from anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on public.connector_zone_assignments from anon, authenticated, service_role",
    );
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal() <> 'aal2'");
    expect(migration).toContain("ai_admin");
    expect(migration).toContain(
      "The proposer cannot independently adopt or reject the same network zone",
    );
    expect(migration).toContain(
      "The proposer cannot independently adopt or reject the same connector zone assignment",
    );
    expect(migration).toContain("operational_authority', false");
    expect(migration).toContain("'operationalAuthority', false");
  });

  it("fails closed for control-zone writes, unassigned connectors, and unzoned reads", () => {
    expect(migration).toContain("control_zone_write_refused");
    expect(migration).toContain("v_zone.purdue_level <= 2");
    expect(migration).toContain("no_adopted_zone_assignment");
    expect(migration).toContain("egress_not_permitted");
    expect(migration).toContain("egress_route_required");
    expect(migration).toContain("else 'unzoned' end");
    expect(migration).toContain("'zone_separation'");
    expect(migration).toContain("which is not OT/IT separation");
    expect(migration).toContain(
      "Assign only to an adopted zone in this tenant",
    );
    expect(migration).toContain("Connector is not registered in this tenant");
    expect(migration).not.toMatch(/https?:\/\//);
  });

  it("gates SAP propose and execution claim without calling SAP", () => {
    expect(migration).toContain("function public.propose_sap_s4_write(");
    expect(migration).toContain(
      "function public.claim_sap_s4_write_execution(",
    );
    expect(migration).toContain(
      "public.connector_zone_crossing(v_org, v_connector.connector_key, 'write')",
    );
    expect(migration).toContain(
      "public.connector_zone_crossing(r.organization_id, c.connector_key, 'write')",
    );
    expect(migration).toContain("'call_sap', false");
    expect(migration).toContain("SAP was not called");
    expect(migration).toContain("trg_sap_s4_write_zone_separation");
    expect(migration).toContain(
      "grant execute on function public.claim_sap_s4_write_execution(uuid, uuid) to service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.claim_sap_s4_write_execution(uuid, uuid) to authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.connector_zone_crossing(uuid, text, text) to authenticated",
    );
    expect(sapCore).toContain("control_zone_write_refused");
    expect(sapCore).toContain("result.sapCalled).toBe(false)");
  });

  it("is customer-reachable from Decision Governance", () => {
    expect(page).toContain("<NetworkSeparationPanel />");
    expect(panel).toContain("proposeNetworkZone");
    expect(panel).toContain("decideNetworkZone");
    expect(panel).toContain("proposeConnectorZoneAssignment");
    expect(panel).toContain("decideConnectorZoneAssignment");
    expect(panel).toContain("getNetworkSeparation");
    expect(panel).toContain(
      "Writes into a declared Purdue 0-2 zone are refused",
    );
    expect(service).toContain('"get_network_separation"');
    expect(service).toContain('"propose_network_zone"');
    expect(service).toContain('"decide_network_zone"');
    expect(service).toContain('"propose_connector_zone_assignment"');
    expect(service).toContain('"decide_connector_zone_assignment"');
  });
});
