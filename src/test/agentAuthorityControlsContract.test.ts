import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219140000_agent_authority_controls.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/agentGovernanceService.ts", "utf8");
const page = readFileSync("src/pages/AIWorkforcePage.tsx", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("per-agent authority controls", () => {
  it("uses normalized per-agent profiles, decision rights, and tool bindings", () => {
    expect(migration).toContain("create table if not exists agent_control_profiles");
    expect(migration).toContain("create table if not exists agent_software_tools");
    expect(migration).toContain("create table if not exists agent_decision_right_bindings");
    expect(migration).toContain("create table if not exists agent_tool_bindings");
    expect(migration).toContain("references ai_agents(id)");
    expect(migration).toContain("references decision_rights(id)");
    expect(migration).not.toMatch(/^end \$\$;/m);
  });

  it("keeps agents advisory and named humans authoritative", () => {
    expect(migration).toMatch(/may_approve boolean not null default false/);
    expect(migration).toMatch(/check \(not may_approve\)/);
    expect(migration).toContain("accountable human approval");
    expect(migration).toContain("v_role = 'ai_admin'");
    expect(migration).toContain("ai/system identities cannot adopt agent authority controls");
    expect(migration).toContain("check_decision_right");
    expect(migration).toContain("decision right is never autonomous");
  });

  it("fails closed on missing, cross-tenant, disabled, or over-limit bindings", () => {
    expect(migration).toContain("agent not found in this organization");
    expect(migration).toContain("no adopted control profile");
    expect(migration).toContain("tool is not enabled for this agent");
    expect(migration).toContain("decision right is not enabled for this agent");
    expect(migration).toContain("proposal exceeds this agent''s risk ceiling");
    expect(migration).toContain("proposal exceeds this agent''s cost ceiling");
    expect(migration).toContain("proposal exceeds this agent''s downtime ceiling");
  });

  it("tenant-scopes every mutable table and exposes only governed RPC writes", () => {
    for (const table of [
      "agent_control_profiles",
      "agent_decision_right_bindings",
      "agent_tool_bindings",
    ]) {
      expect(migration).toContain(`alter table ${table} enable row level security`);
      expect(migration).toContain(`${table}.organization_id = app_current_org()`);
    }
    expect(migration).toContain("revoke insert, update, delete");
    expect(migration).toContain("configure_agent_controls");
    expect(migration).toContain("security_events");
    expect(migration).toContain("adopted agent controls are immutable");
    expect(migration).toContain("bindings can only be added while the profile is draft");
  });

  it("is reachable from the customer AI Workforce surface", () => {
    expect(service).toContain('supabase.rpc("configure_agent_controls"');
    expect(service).toContain('supabase.rpc("evaluate_agent_control"');
    expect(page).toContain("AgentControlPanel");
    const panel = readFileSync("src/components/AgentControlPanel.tsx", "utf8");
    expect(panel).toContain("Human approval remains mandatory");
  });

  it("advances exactly C1.14-C1.16 with concrete evidence", () => {
    for (const id of ["C1.14", "C1.15", "C1.16"]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅[^\\n]+agent`, "i"),
      );
    }
  });
});
