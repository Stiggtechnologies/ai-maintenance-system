import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219161000_develop_governance_agent.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/develop-governance-agent/index.ts",
  "utf8",
);
const core = readFileSync(
  "supabase/functions/_shared/develop-governance-core.ts",
  "utf8",
);
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");
const panel = readFileSync("src/components/GovernanceAgentPanel.tsx", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
const boundary = JSON.parse(
  readFileSync("config/edge-function-boundary.json", "utf8"),
) as { activeFunctions: string[]; allowedNoVerifyJwt: string[] };

describe("D12.18 Governance Agent contract", () => {
  it("reuses canonical tenant-scoped sources and exposes only an admin read RPC", () => {
    expect(migration).toContain("v_org uuid := app_current_org()");
    expect(migration).toContain("case_binding_gate_demands(c.id, null)");
    expect(migration).toContain("from standard_site_variances");
    expect(migration).toContain("from security_events");
    expect(migration).toContain("event_type = 'access_denied'");
    expect(migration).toContain("v_role not in ('admin', 'ai_admin')");
    expect(migration).toContain(
      "revoke all on function public.screen_governance_agent",
    );
    expect(migration).toContain(
      "grant execute on function public.screen_governance_agent(integer, integer)\n  to authenticated",
    );
    expect(migration).not.toMatch(/create table/);
  });

  it("uses the caller JWT and has no service-role or mutation client", () => {
    expect(edge).toContain('Deno.env.get("SUPABASE_ANON_KEY")');
    expect(edge).toContain("Authorization: auth");
    expect(edge).toContain('caller.rpc("screen_governance_agent"');
    expect(edge).not.toContain("SERVICE_ROLE");
    expect(edge).not.toMatch(/\.from\(/);
    expect(edge).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("keeps findings advisory, bounded and traceable", () => {
    expect(core).toContain('"rpc:case_binding_gate_demands"');
    expect(core).toContain("standard_site_variances:");
    expect(core).toContain("security_events:");
    expect(core).toContain("casesTruncated");
    expect(core).toContain("not proof that no governance issue exists");
    expect(core).toContain(
      "cannot approve, reject, waive, accept risk, pass a gate",
    );
  });

  it("is reachable and JWT verified, without a no-verify exception", () => {
    expect(page).toContain("<GovernanceAgentPanel />");
    expect(panel).toContain("Detection only");
    expect(panel).toContain("Run governance screen");
    expect(config).toContain(
      "[functions.develop-governance-agent]\nverify_jwt = true",
    );
    expect(boundary.activeFunctions).toContain("develop-governance-agent");
    expect(boundary.allowedNoVerifyJwt).not.toContain(
      "develop-governance-agent",
    );
  });
});
