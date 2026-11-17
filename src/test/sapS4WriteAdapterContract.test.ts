import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271103130000_sap_s4_write_back.sql",
);
const shared = read("supabase/functions/_shared/sap-s4-write.ts");
const edge = read("supabase/functions/sap-s4-write-execute/index.ts");
const service = read("src/services/sapS4Write.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const approval = read(
  "supabase/migrations/00000000000022_approval_authority_contract.sql",
);
const workflow = read(".github/workflows/deploy-migrations.yml");
const boundary = read("config/edge-function-boundary.json");
const config = read("supabase/config.toml");
const doc = read("docs/sap-s4-write-back.md");

describe("SAP S/4HANA human-approved write-back contract", () => {
  it("reuses connectors, the approval-authority function, and the one audit ledger", () => {
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("public.app_has_approval_authority()");
    expect(migration).toContain(
      "public.app_user_has_approval_authority(p_actor)",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table[^;]*audit/i);
    expect(migration).not.toMatch(/create policy[^;]*audit_events/i);
    expect(migration).not.toMatch(
      /drop trigger[^;]*trg_audit_events_append_only/i,
    );
    expect(migration).toContain("payload_sha256");
    expect(migration).toContain("sap_http_status");
    expect(migration).toContain("'requested_by'");
    expect(migration).toContain("'decided_by'");
    expect(migration).toContain(
      "the requester cannot approve their own SAP write",
    );
    expect(migration).toContain("approval_authority_required");
    for (const role of [
      "admin",
      "manager",
      "maintenance_manager",
      "plant_manager",
      "operations_manager",
      "reliability_engineer",
    ]) {
      expect(approval).toContain(`'${role}'`);
      expect(shared).toContain(`"${role}"`);
    }
  });

  it("keeps writes disabled by default and refuses client mutation of the audit path", () => {
    expect(migration).toContain("enabled boolean not null default false");
    expect(migration).toContain(
      "SAP writes are disabled for this tenant until an administrator sets the explicit write flag",
    );
    expect(migration).toContain("for select");
    expect(migration).toContain("organization_id = public.app_current_org()");
    expect(migration).not.toMatch(
      /create policy[^;]*sap_s4_write_(?:settings|requests)[^;]*\bfor\s+(update|delete|all)\b/i,
    );
    expect(migration).toContain("SAP write records cannot be deleted");
    expect(migration).toContain(
      "revoke truncate on table public.sap_s4_write_requests",
    );
    expect(migration).toContain("'call_sap', false");
    expect(migration).toContain("'call_sap', true");
    expect(migration).toContain("status = 'approved'");
    expect(migration).toContain("idempotent_replay");
  });

  it("allowlists the published notification and maintenance-order operations", () => {
    for (const token of [
      "API_MAINTNOTIFICATION",
      "MaintenanceNotification",
      "API_MAINTENANCEORDER",
      "ReleaseMaintenanceOrder",
      "maintenance_notification_create",
      "maintenance_notification_text_update",
      "maintenance_order_release",
      "X-CSRF-Token",
    ]) {
      expect(shared).toContain(token);
      expect(migration).toContain(
        token === "X-CSRF-Token" ? "No SAP call was made." : token,
      );
    }
    expect(shared).toContain("If-Match");
    expect(doc).toContain("not certified against a customer SAP tenant");
    expect(doc).toContain("API_MAINTNOTIFICATION");
    expect(doc).toContain("ReleaseMaintenanceOrder");
  });

  it("does not reach HTTP unless the execution claim says the request was approved", () => {
    expect(
      edge.indexOf('rpc(serviceClient, "claim_sap_s4_write_execution"'),
    ).toBeLessThan(edge.indexOf("runSapWriteExecution({"));
    expect(edge).toContain("normalizeSapWriteExecuteRequest(body)");
    expect(edge).toContain("p_actor: actorId");
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).toContain("x-client-info");
    expect(edge).toContain("apikey");
    expect(shared).toContain(
      'if (!claim.callSap || claim.statusAtClaim !== "approved")',
    );
    expect(workflow).not.toContain("sap-s4-write-execute");
    expect(boundary).not.toContain("sap-s4-write-execute");
    expect(config).toContain(
      "[functions.sap-s4-write-execute]\nverify_jwt = true",
    );
  });

  it("wires propose, decide, and execute through the integrations surface", () => {
    expect(page).toContain("SapS4WriteConnectorSetup");
    expect(service).toContain('"propose_sap_s4_write"');
    expect(service).toContain('"decide_sap_s4_write"');
    expect(service).toContain('"set_sap_s4_write_enabled"');
    expect(service).toContain('"sap-s4-write-execute"');
    const component = read("src/components/SapS4WriteConnectorSetup.tsx");
    expect(component).toContain("Enable SAP writes for this tenant");
    expect(component).toContain("Execute approved write");
    expect(component).toContain("not certified against a customer SAP tenant");
  });
});
